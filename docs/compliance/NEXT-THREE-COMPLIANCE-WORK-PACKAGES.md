# SolarPro — Next Three Highest-Priority Compliance Work Packages

**Date:** 2026-07-09
**Author:** Automated compliance analysis (automated acceptance test agent)
**Branch:** dev (commit `930fde1e`)
**Preceded by:** MFA Phase 3 evidence correction — documentation & gap cleanup (commit `930fde1e`)
**Status:** SOC 2 readiness in progress — NOT certified. Security controls aligned with ISO 27001:2022 principles.
**Classification:** Internal — Redacted

---

## 1. Purpose and Methodology

This document identifies the next three highest-priority compliance work packages across the full SolarPro SOC 2 and ISO 27001:2022 readiness program — not limited to MFA. The selection methodology is as follows:

1. **Risk Register Priority:** The SolarPro risk register (`RSK-001-Risk-Register-and-Assessment.md`) identifies 20 risks across 11 categories (1 Critical, 13 High, 4 Medium, 0 Low). MFA implementation addressed RSK-001 (the single Critical risk). The remaining 13 High risks drive the next priorities.
2. **SOC 2 TSC Coverage:** The SOC 2 Trust Services Criteria mapping identifies gaps across CC6.1–CC6.3, CC7.1–CC7.3, CC8.1, CC9.2, A1.2, and P1.1. Work packages are selected to close the broadest and highest-severity TSC gaps.
3. **ISO 27001:2022 Control Coverage:** The ISO 27001:2022 mapping identifies gaps across A.5, A.8, and Annex A control families. Work packages are selected to address controls that are currently unimplemented or have only policy-level coverage with no operational enforcement.
4. **Agent Capability Constraint:** Per standing directive, the agent must complete or automate as much as possible without requiring Raymond to do manual technical verification. Work packages are prioritized for what the agent can do now (documentation, code changes on dev, CI configuration) versus what requires Raymond (Vercel dashboard access, infrastructure decisions, cost approvals).
5. **Effort-to-Impact Ratio:** Work packages that close multiple risk register entries and multiple TSC/ISO controls with manageable effort are prioritized over single-risk, single-control packages.

**Critical language:** All mappings in this document are internal readiness assessments. They have NOT been validated by an external auditor and do not constitute SOC 2 certification, ISO 27001 certification, or attestation of any kind. SolarPro is in SOC 2 readiness — not certified.

---

## 2. Work Package 1 — Dependency Vulnerability Scanning & Secret Detection in CI

### 2.1 Summary

**Title:** Implement automated dependency vulnerability scanning and secret detection in the CI pipeline.

**Risk Register Entries Closed:** RSK-005 (Third-Party API Key Exposure — High), RSK-019 (Dependency Vulnerability — High)

**SOC 2 TSC Addressed:** CC7.1 (System Boundaries), CC7.2 (Monitoring & Detection)

**ISO 27001:2022 Addressed:** A.8.16 (Monitoring of systems), A.8.25 (Secure development lifecycle), A.8.28 (Secure coding), A.5.15 (Access control to source code)

**Current State:**

The CI pipeline (`.github/workflows/ci.yml`) currently runs five jobs: unit tests (vitest), TypeScript type check, ESLint, env var audit, and build gate. There is NO automated vulnerability scanning of npm dependencies, NO secret detection scanning, NO Software Bill of Materials (SBOM) generation, and NO dependency review process. GitHub's Dependabot is not confirmed as enabled on the repository. The risk register (RSK-005) identifies that no pre-commit hook for secret detection exists and no automated scan of git history has been performed. The risk register (RSK-019) identifies that no automated vulnerability scanning runs in CI, no SBOM exists, and no dependency review process exists.

The SolarPro application integrates with third-party APIs (Stripe, Anthropic, OpenAI, Resend, Google Maps) whose API keys are managed through Vercel environment variables. While the `.env.example` pattern is followed and `.env` files are git-ignored, there is no automated guard against a developer accidentally committing a real secret value. GitHub's built-in secret scanning is enabled (per RSK-005 current controls), but this is reactive (detects after commit) rather than preventive (blocks before commit).

**What the Agent Can Do (on dev, without Raymond):**

1. **Add `npm audit` to CI pipeline:** Add a new CI job that runs `npm audit --audit-level=moderate` on every push and pull request. This will fail the CI build if any moderate or higher vulnerability is found in the dependency tree. The job should use `npm audit --audit-level=moderate --omit=dev` to focus on production dependencies, with a separate optional job for dev dependencies at `--audit-level=high`.

2. **Add TruffleHog secret scanning to CI:** Add a CI job that runs TruffleHog (`trufflehog github --repo-path=.` or the GitHub Action `trufflesecurity/trufflehog@main`) to scan the full git history for exposed secrets. This addresses RSK-005's gap of "no automated scan of git history."

3. **Add a pre-commit hook for local secret detection:** Create a `.husky/pre-commit` hook (or a simple shell script in `scripts/pre-commit-secret-scan.sh`) that runs `trufflehog filesystem --no-update --since-commit HEAD` or `git-secrets --scan` before each commit. Document the setup in the developer README or contributing guide.

4. **Generate SBOM on each build:** Add a CI step that runs `npm sbom --sbom-format cyclonedx-1.5 > sbom.json` (npm 8.13+) or uses `@cyclonedx/cyclonedx-npm` to generate a CycloneDX SBOM. Upload the SBOM as a CI artifact. This satisfies the RSK-019 gap of "no SBOM (Software Bill of Materials)."

5. **Document the dependency review process:** Create a brief `docs/compliance/PRO-DEP-001-Dependency-Review-Procedure.md` document that defines: (a) how new npm packages are reviewed before addition, (b) the npm audit cadence, (c) the SBOM review process, (d) the vulnerability remediation SLA (Critical: 24 hours, High: 7 days, Medium: 30 days, Low: next release).

6. **Verify Dependabot configuration:** Check whether `.github/dependabot.yml` exists. If not, create one with: `package-ecosystem: "npm"`, `directory: "/"`, `schedule.interval: "weekly"`, and `open-pull-requests-limit: 10`. This enables automated dependency update PRs.

**What Requires Raymond:**

- Enabling GitHub Advanced Security features (if beyond the free tier) — Raymond controls the GitHub billing settings.
- Approving the addition of `trufflehog` or `@cyclonedx/cyclonedx-npm` as dev dependencies (cost/licensing review).

**Estimated Effort:** 4–6 hours (agent can complete entirely on dev)

**Acceptance Criteria:**

- CI pipeline runs `npm audit` on every push/PR and fails on moderate+ vulnerabilities
- CI pipeline runs TruffleHog secret scanning on every push/PR
- SBOM is generated as a CI artifact on every build
- Pre-commit secret detection hook is documented and committed
- Dependabot configuration file exists (if not already present)
- `PRO-DEP-001-Dependency-Review-Procedure.md` is committed to `docs/compliance/`
- Health endpoint or CI status reflects the new scanning jobs

**Compliance Posture After Completion:**

RSK-005 (API Key Exposure) target risk level moves from High to Low. RSK-019 (Dependency Vulnerability) target risk level moves from High to Medium. SOC 2 CC7.1 and CC7.2 gain operational evidence of automated security scanning. ISO 27001 A.8.16, A.8.25, and A.8.28 gain implementation evidence beyond policy documentation.

---

## 3. Work Package 2 — Backup Verification & Database Audit Log Integrity Verification

### 3.1 Summary

**Title:** Implement automated database backup verification and direct audit log hash chain integrity verification — closing the Tier 3 (database/log) verification gap.

**Risk Register Entries Closed:** RSK-004 (Database Data Loss — High), RSK-010 (Inadequate Audit Logging — High, partially), RSK-020 (Business Continuity Failure — High, partially)

**SOC 2 TSC Addressed:** CC7.2 (Monitoring & Detection), CC7.3 (Incident Response & Recovery), A1.2 (Availability)

**ISO 27001:2022 Addressed:** A.8.13 (Information backup), A.8.15 (Logging of events), A.8.16 (Monitoring of systems), A.5.24 (Information security incident management planning)

**Current State:**

Three significant gaps converge on the database and logging layer:

1. **No independent backup:** The SolarPro database runs on Neon PostgreSQL, which provides point-in-time recovery (PITR) with 7-day WAL retention and automatic HA. However, RSK-004 identifies that there is no independent backup outside Neon, and PITR is limited to 7 days. If Neon itself were to experience a platform-level failure, SolarPro would have no recovery path. No `pg_dump` backup to an independent store (Google Cloud Storage, AWS S3) has been implemented.

2. **Audit log hash chain not directly verified:** The MFA acceptance test record (Section 2.0.3) explicitly documents that direct database query of the `audit_log` table to confirm hash chain integrity was NOT performed during acceptance testing. The hash-chained audit log (`lib/auditLog.ts`, Migration 100) is source-verified (Tier 2) and operationally confirmed (audit calls execute without throwing), but no one has directly queried the database to verify that `entry_hash = SHA256(prev_hash + payload)` for actual stored rows. This is the Tier 3 verification gap identified across all three corrected compliance documents.

3. **No restore testing:** RSK-020 identifies that the BCDR plan (POL-SEC-011) exists but has never been tested. No backup restore test has been performed. No disaster recovery drill has been conducted. The RTO/RPO objectives are documented but unverified.

**What the Agent Can Do (on dev, without Raymond — with a DATABASE_URL):**

1. **Create a verification script (`scripts/verify-audit-log-hash-chain.ts` or `.py`):** This script connects to the database using the `DATABASE_URL` environment variable and runs: `SELECT id, action, prev_hash, entry_hash, payload, created_at FROM audit_log ORDER BY id ASC LIMIT 100`. For each row, it recomputes `expected_hash = SHA256(prev_hash + payload)` and compares it to the stored `entry_hash`. If any mismatch is found, it reports the row and exits with a non-zero status. This directly closes the Tier 3 hash chain verification gap documented in the acceptance test record Section 2.0.3.

2. **Create a plaintext-secret database verification script (`scripts/verify-no-plaintext-secrets.ts` or `.py`):** This script connects to the database and queries: `SELECT id, mfa_secret_encrypted FROM users WHERE mfa_secret_encrypted IS NOT NULL` — verifying that each value matches the expected AES-256-GCM format (`iv:authTag:encrypted` in base64, with `iv` being 12 bytes and `authTag` being 16 bytes when base64-decoded). It also queries: `SELECT id, code_hash FROM mfa_recovery_codes` — verifying that each `code_hash` is a 64-character hex string (SHA-256) and NOT an 8-character plaintext recovery code. This directly closes the Tier 3 plaintext-secret storage verification gap.

3. **Create a backup script (`scripts/backup-database.sh`):** This script runs `pg_dump $DATABASE_URL --no-owner --no-privileges --format=custom --file=backup-$(date +%Y%m%d).dump` and uploads the result to an independent storage location. The script should be designed to run as a scheduled task (Vercel Cron, GitHub Actions scheduled workflow, or external scheduler). **Note:** The destination storage (GCS bucket, S3 bucket) requires Raymond to provision the bucket and set credentials. The script itself can be written and committed by the agent; the scheduling and bucket provisioning require Raymond.

4. **Create a restore test script (`scripts/test-database-restore.sh`):** This script takes a backup file, restores it to a temporary database (or Neon branch), runs a smoke test (query row counts, verify audit_log hash chain on the restored data), and reports success or failure. This provides the quarterly restore testing capability required by RSK-020.

5. **Document the backup and verification procedure:** Create `docs/compliance/OPS-DBK-001-Database-Backup-and-Verification-Procedure.md` that defines: (a) backup cadence (daily pg_dump, Neon PITR 7-day), (b) backup destination (independent cloud storage), (c) verification cadence (hash chain check weekly, plaintext-secret check weekly, restore test quarterly), (d) the scripts and how to run them, (e) the escalation procedure if verification fails.

**What Requires Raymond:**

- Provisioning an independent cloud storage bucket (GCS or S3) for pg_dump backups — requires cloud console access and cost approval.
- Scheduling the backup and verification scripts (Vercel Cron configuration or external scheduler setup) — requires Vercel dashboard access.
- Providing a read-only `DATABASE_URL` or confirming the existing `DATABASE_URL` can be used for verification scripts — Raymond controls database credentials.
- Running the scripts once to produce the first set of verification evidence — requires database access (Raymond's account or a provided read-only connection string).

**Estimated Effort:** 6–8 hours for the agent (scripts + documentation); 1–2 hours for Raymond (bucket provisioning, scheduling, first verification run)

**Acceptance Criteria:**

- `scripts/verify-audit-log-hash-chain.ts` exists, runs successfully against the dev database, and reports hash chain integrity (pass/fail per row)
- `scripts/verify-no-plaintext-secrets.ts` exists, runs successfully against the dev database, and confirms all `mfa_secret_encrypted` values are AES-256-GCM encrypted and all `code_hash` values are SHA-256 hashes
- `scripts/backup-database.sh` exists and is documented
- `scripts/test-database-restore.sh` exists and is documented
- `docs/compliance/OPS-DBK-001-Database-Backup-and-Verification-Procedure.md` is committed
- First verification run produces evidence that the audit log hash chain is intact and no plaintext secrets are stored (or identifies issues to remediate)
- MFA acceptance test record Tier 3 verification gaps (Section 2.0.3) are closed with direct evidence

**Compliance Posture After Completion:**

RSK-004 (Database Data Loss) target risk level moves from High to Medium (independent backup in place; PITR retention gap may remain). RSK-010 (Inadequate Audit Logging) moves further toward Low (hash chain directly verified). RSK-020 (BCDR Failure) moves from High to Medium (restore testing capability in place). SOC 2 CC7.2, CC7.3, and A1.2 gain direct operational evidence. ISO 27001 A.8.13, A.8.15, and A.8.16 gain implementation evidence. The Tier 3 (database/log) verification gaps documented in the corrected acceptance test record are closed with direct query evidence.

---

## 4. Work Package 3 — Branch Protection Enforcement, Change Classification, and Access Review Execution

### 4.1 Summary

**Title:** Verify and enforce GitHub branch protection rules, implement change classification, and execute the first quarterly access review — operationalizing the change management and access control policies.

**Risk Register Entries Closed:** RSK-014 (Insufficient Change Management — High), RSK-016 (Incomplete Offboarding — High), RSK-006 (Insider Threat — High, partially)

**SOC 2 TSC Addressed:** CC6.2 (Access Removal), CC6.3 (Access Authorization), CC8.1 (Change Management)

**ISO 27001:2022 Addressed:** A.5.15 (Access control to source code), A.5.18 (Access rights), A.8.32 (Change management), A.5.10 (Information security incident response — for break-glass audit)

**Current State:**

Three operational governance gaps remain across change management and access control:

1. **Branch protection may not be enforced:** RSK-014 identifies that branch protection rules "may not be enforced" on the GitHub repository. The Change Management Policy (POL-SEC-006) exists as a document, but there is no verified evidence that GitHub branch protection (require PR review, require status checks, restrict direct pushes to master) is actually enabled. Without enforcement, the documented PR review process can be bypassed by direct pushes to master. The agent works only on dev per directive and never touches master, but the enforcement of branch protection is a platform-level control that Raymond must verify.

2. **No change classification:** POL-SEC-006 defines change types (standard, normal, emergency) but there is no implemented mechanism to classify changes. No PR template, no labeling system, no enforcement of classification before merge. RSK-014 identifies the need for "change classification" and "emergency change retrospective."

3. **Quarterly access review not executed:** The Quarterly Access Review template (`TMP-ACC-001-Quarterly-Access-Review.md`) exists but has never been completed with actual review data. RSK-016 identifies that no offboarding checklist implementation exists and no automated access revocation is in place. RSK-006 identifies the need for "quarterly access reviews" and "break-glass audit." Without a completed access review, there is no evidence that stale accounts, unused permissions, or departed personnel with residual access have been identified and remediated.

**What the Agent Can Do (on dev, without Raymond):**

1. **Verify branch protection via `gh` CLI:** The agent has access to the `gh` CLI with the authenticated user's token. Run `gh api repos/rayobrian6/Solarpro/branches/master/protection` to check whether branch protection rules are configured on master. Document the findings (enabled or not, which rules are active). If branch protection is NOT enabled, document the recommended rules to enable (require PR review, require status checks, restrict direct pushes). The agent cannot enable branch protection (requires repo admin access via Raymond), but can verify and document the current state.

2. **Create a PR template with change classification:** Create `.github/pull_request_template.md` with a structured template that requires the PR author to classify the change as: Standard (routine change, full review), Normal (significant change, full review + additional approver), or Emergency (urgent change, expedited review with retrospective required within 48 hours). The template should also require: description of change, risk assessment, testing performed, rollback plan, and compliance impact (does this change affect security controls, audit logging, data protection, or access control?).

3. **Create an emergency change retrospective template:** Create `docs/compliance/TMP-CHG-001-Emergency-Change-Retrospective.md` that must be completed within 48 hours of any emergency change. The template should capture: what changed, why it was an emergency, who approved it, what testing was performed, what the rollback plan was, whether the rollback was needed, and what process improvements should be made.

4. **Create an access review execution script (`scripts/access-review.ts` or `.py`):** This script connects to the database and generates a report of all users with their roles, MFA enrollment status, last login timestamp (if tracked), and account creation date. The report is formatted for the quarterly access review template. The script does NOT make any changes — it is read-only and produces a report that the security lead reviews. This operationalizes the `TMP-ACC-001-Quarterly-Access-Review.md` template with actual data.

5. **Create an offboarding checklist operationalization script (`scripts/offboarding-verify.ts` or `.py`):** This script, given a user ID or email, verifies: (a) the user's role (to understand what access they had), (b) whether the user's account is still active, (c) whether any sessions are still valid, (d) whether the user appears in the audit log after their departure date. This provides the automated access revocation verification that RSK-016 identifies as missing.

6. **Document the change management enforcement procedure:** Create `docs/compliance/PRO-CHG-001-Change-Management-Enforcement-Procedure.md` that defines: (a) the GitHub branch protection rules that must be enabled (with the exact `gh` commands or GitHub settings), (b) the PR classification process, (c) the emergency change process and retrospective requirement, (d) the merge approval requirements per change type, (e) the audit trail expectations.

7. **Execute the first access review (data-only):** Using the access review script, generate the user access report and populate a completed `TMP-ACC-001-Quarterly-Access-Review.md` with the actual data. This produces the first evidence of a completed access review. The review findings (whether any stale accounts or unused permissions were found) should be documented.

**What Requires Raymond:**

- Enabling or modifying GitHub branch protection rules — requires repo admin access (the agent's `gh` token may or may not have admin scope).
- Reviewing and signing off on the first quarterly access review — the security lead (Raymond) must review the generated report and confirm that all accounts are legitimate, no stale access exists, and any findings are remediated.
- Executing the offboarding checklist for any departed personnel — requires knowledge of who has departed (Raymond's personnel knowledge).

**Estimated Effort:** 5–7 hours for the agent (scripts, templates, documentation, first review generation); 1–2 hours for Raymond (branch protection verification/enforcement, access review sign-off)

**Acceptance Criteria:**

- Branch protection status on master is verified and documented (enabled rules listed, or recommended rules documented if not enabled)
- `.github/pull_request_template.md` exists with change classification fields
- `docs/compliance/TMP-CHG-001-Emergency-Change-Retrospective.md` exists
- `docs/compliance/PRO-CHG-001-Change-Management-Enforcement-Procedure.md` exists
- `scripts/access-review.ts` exists, runs successfully, and generates a user access report
- `scripts/offboarding-verify.ts` exists and runs successfully
- First quarterly access review is populated with actual data and committed as evidence
- RSK-014, RSK-016, and RSK-006 risk register entries are updated to reflect the new controls

**Compliance Posture After Completion:**

RSK-014 (Insufficient Change Management) target risk level moves from High to Low (branch protection verified, change classification implemented, emergency retrospective process in place). RSK-016 (Incomplete Offboarding) target risk level moves from High to Low (offboarding verification script in place, first access review completed). RSK-006 (Insider Threat) moves further toward Medium (quarterly access review executed, break-glass audit capability documented). SOC 2 CC6.2, CC6.3, and CC8.1 gain operational evidence beyond policy documentation. ISO 27001 A.5.15, A.5.18, and A.8.32 gain implementation evidence.

---

## 5. Priority Justification and Sequencing

### 5.1 Why These Three Packages

These three work packages were selected from the 13 remaining High-risk entries in the risk register and the broader SOC 2 / ISO 27001 control gaps for the following reasons:

**Work Package 1 (Dependency & Secret Scanning) is first** because it addresses two High risks (RSK-005, RSK-019) that are entirely within the agent's capability to resolve, requires no infrastructure decisions or cost approvals from Raymond, and can be completed in a single session. It also provides immediate defensive value — automated secret detection prevents the most common developer error (accidental secret commits), and dependency vulnerability scanning catches known CVEs before they reach production. The effort-to-impact ratio is excellent: 4–6 hours of work closes two High risks and addresses four ISO 27001 controls.

**Work Package 2 (Backup Verification & Audit Log Integrity) is second** because it directly closes the Tier 3 (database/log) verification gap that was the central finding of the MFA Phase 3 evidence correction. The corrected acceptance test record explicitly documents that direct database and log inspection was NOT performed — these scripts provide the mechanism to perform that verification. It also addresses three High risks (RSK-004, RSK-010, RSK-020) and provides the backup independence that RSK-004 identifies as critical. The agent can write all scripts and documentation; Raymond's involvement is limited to provisioning a storage bucket and running the first verification. The compliance posture improvement is significant because it converts "source-verified only" claims into "directly verified" claims.

**Work Package 3 (Branch Protection, Change Classification & Access Review) is third** because it addresses the operational governance gaps that prevent the existing policies from being enforced. Policies exist for change management (POL-SEC-006), access control (POL-SEC-003), and offboarding (CHK-OFB-001), but without branch protection enforcement, change classification, and executed access reviews, these policies are aspirational rather than operational. This package addresses three High risks (RSK-014, RSK-016, RSK-006) and converts policy documentation into operational evidence. The agent can create all templates, scripts, and documentation; Raymond's involvement is limited to verifying/enabling branch protection and signing off on the first access review.

### 5.2 What These Three Packages Do NOT Address

The following High risks remain after these three work packages and are identified for future prioritization:

- **RSK-001 (Compromised Credentials):** MFA is implemented (37 automated tests passed); remaining work is the mandatory admin/super_admin operational test, the staff role resolution, and the secure admin MFA reset procedure. These are documented in the acceptance test record and next-phase plan.
- **RSK-002 (SQL Injection):** Parameterized queries are in place; ongoing CI testing is the treatment. This is partially addressed by Work Package 1 (if SQL injection testing is added to CI).
- **RSK-003 (Vercel Outage):** Requires a fallback deployment platform decision and status page — infrastructure decision requiring Raymond.
- **RSK-007 (DDoS):** Requires rate limiting standardization across all routes and Cloudflare evaluation — code change and infrastructure decision.
- **RSK-008 (IDOR):** Requires systematic IDOR testing and tenant isolation verification — code change requiring a testing framework.
- **RSK-009 (Vendor Breach):** Requires vendor security questionnaires and DPAs — process work requiring Raymond's engagement with vendors.
- **RSK-011 (Privacy Violation):** Requires data export API, right-to-delete endpoint, cookie consent — code changes and legal review.
- **RSK-012 (AI Data Processing):** Requires zero-data-retention verification and PII scrubbing — code changes.
- **RSK-017 (Regulatory Non-Compliance):** Requires quarterly regulatory review and legal counsel — process work requiring Raymond.
- **RSK-018 (Session Hijacking):** Requires session timeout enforcement and concurrent session limits — code change.
- **RSK-020 (BCDR Failure):** Partially addressed by Work Package 2 (restore testing); full resolution requires an annual BCDR tabletop exercise.

### 5.3 Risk Summary After These Three Packages

| Metric | Before | After Work Packages 1–3 |
|--------|--------|-------------------------|
| Critical risks | 0 (RSK-001 mitigated by MFA) | 0 |
| High risks | 13 | 7 (RSK-005, RSK-019, RSK-004, RSK-010, RSK-014, RSK-016 addressed; RSK-006 partially addressed) |
| Medium risks | 4 | 7 (several High risks move to Medium) |
| Low risks | 0 | 3 (RSK-005, RSK-014, RSK-016 move to Low) |

### 5.4 Recommended Execution Sequence

1. **Work Package 1 first** — fully within agent capability, no Raymond action required, closes 2 High risks, 4–6 hours
2. **Work Package 2 second** — agent writes all scripts and documentation (6–8 hours), then Raymond provisions bucket and runs first verification (1–2 hours)
3. **Work Package 3 third** — agent creates all templates, scripts, and documentation and generates first access review (5–7 hours), then Raymond verifies branch protection and signs off on access review (1–2 hours)

Total agent effort: 15–21 hours across three work packages.
Total Raymond effort: 2–4 hours (storage bucket provisioning, branch protection verification, access review sign-off, first verification run).

---

## 6. Compliance Language Reminder

| Forbidden | Allowed |
|-----------|---------|
| "SOC 2 certified" | "SOC 2 readiness in progress" |
| "ISO 27001 certified" | "Security controls aligned with ISO 27001:2022 principles" |
| "HIPAA compliant" | *(no alternative — do not reference HIPAA)* |
| "audited" | "Verified through internal review" |
| "certified" | "Aligned with [standard] requirements" |

---

*This document identifies the next three highest-priority compliance work packages for internal readiness planning. It does not constitute certification, attestation, or auditor validation of any kind. SolarPro is in SOC 2 readiness — NOT certified. Security controls are aligned with ISO 27001:2022 principles.*
