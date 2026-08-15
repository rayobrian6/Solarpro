# Backup & Recovery Policy

| Field | Value |
|---|---|
| **Policy** | POL-OP-006 — Backup & Recovery Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro production data, configuration, and deployment state. Every system that, if lost, would prevent Solarpro from serving customers or from meeting audit-evidence retention. |

---

## 1. Purpose

This policy is the rule for what we back up, how often, where it lives, and how we prove we can get it back. It's the **SOC 2 CC9.1 + ISO 27001 A.8.13** evidence: that the data, configuration, and deployment state Solarpro depends on can be restored within a known time after a known failure, and that the restore is tested on a known cadence.

A 3-person team with no on-prem footprint inherits a lot from cloud providers — Vercel, Neon, Render, and Cloudflare each have their own backup posture. This policy does not duplicate the vendor's commitments; it documents which vendor commitments Solarpro relies on, where the gaps are, and what Solarpro adds on top. The combined posture is what the auditor evaluates.

This policy is paired with the (forthcoming) Business Continuity & Disaster Recovery Plan, which covers the broader scenario of a multi-system outage (region failure, vendor bankruptcy, ransomware). The Backup & Recovery Policy covers "the data is recoverable"; the BC/DR Plan covers "the business can keep operating."

## 2. Scope

This policy applies to:

- **Production database** — Neon Postgres. Customer accounts, projects, proposals, surveys, permit snapshots, audit log, and all derived data.
- **Deployment configuration** — Vercel project settings, Render service settings, Cloudflare DNS / R2 / WAF rules, GitHub repository settings (branch protection, secrets, environments).
- **Evidence store** — Cloudflare R2 bucket `solarpro-compliance-evidence`. Audit logs, weekly monitoring digests, vendor SOC 2 reports, policy snapshots.
- **Service state** — the SAM2 service on Render (model weights, ONNX INT8 artifacts, configuration).
- **Secrets** — the production secrets in Vercel's secret store, the Render secret store, and the GitHub Actions secrets. Secrets are not "backed up" in the traditional sense; they are rotated per the Encryption & Key Management Policy (forthcoming) and version-controlled in `.env.example` for documentation.

Out of scope: developer laptops (covered by the Acceptable Use Policy), non-production environments, and the `compliance/` documentation itself (which is git-versioned and recoverable from any clone).

## 3. Recovery targets

The targets below are the **SOC 2 CC9.1** evidence. They are commitments, not aspirations; missing a target is a Sev2 incident.

| System | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) | Notes |
|---|---|---|---|
| **Production database (Neon)** | **4 hours** | **1 hour** | RPO covered by Neon PITR (continuous, 7-day window — see §4.1). RTO assumes a fresh Neon project can be provisioned and PITR restored within the window. |
| **Full stack (app + DB + services)** | **24 hours** | **1 hour** | The full-stack RTO assumes the database RTO is met and the application can be redeployed from a Vercel + Render restore. |
| **Evidence store (R2)** | **24 hours** | **24 hours** | The R2 evidence is rarely written; the RPO is the last successful daily snapshot. The RTO is the time to re-create the bucket from versioned copies. |
| **Deployment configuration** | **4 hours** | **Last successful deploy** | Vercel and Render retain the previous N deploys; rollback is the recovery path. |
| **SAM2 service state** | **4 hours** | **Last successful deploy** | Model weights are rebuilt from the ONNX artifacts in the repository. The cold-start time of the SAM2 service is the binding constraint. |
| **Secrets** | **1 hour** | **Last rotation** | Rotation is the recovery. The secret is re-issued from the issuing system (Vercel, GitHub, etc.). |

### 3.1 Why these numbers

The 4-hour database RTO is set by customer expectation: a proposal or a permit snapshot that is being worked on at 9am should be reachable by lunch. The 1-hour RPO is set by Neon PITR's continuous backup window — anything more conservative is a vendor capability we are not using.

The 24-hour full-stack RTO is set by the realistic rebuild time: database restore (≤2h) + Vercel redeploy (≤30min) + Render redeploy (≤30min) + DNS / Cloudflare verification (≤30min) + smoke test (≤1h) + buffer.

These are not aspirational. The weekly restore test (§5) measures them. If the test consistently lands inside the targets, the targets are confirmed. If the test consistently exceeds them, the targets are revised with a written rationale.

## 4. Backup scope and cadence

### 4.1 Production database — Neon Postgres PITR

**Mechanism**: Neon Point-In-Time Recovery (PITR). Neon maintains a continuous write-ahead log and can restore to any point within the **7-day window**.

**What it covers**: the entire production database. Every schema, every row, every migration, the audit log.

**Cadence**: continuous (every committed transaction is journaled).

**Verification**: the PITR status is checked weekly. The `compliance/monitoring/neon-pitr-status-<date>.json` artifact captures the window depth, the last successful restore test, and the PITR configuration.

**Vendor commitment**: Neon's SOC 2 Type 2 report (collected under the Vendor Risk Management Policy) covers their backup posture. Solarpro inherits that posture; this policy adds the weekly verification and the quarterly full-restore test.

**Solarpro-specific**: the PITR is enabled on the production Neon project. The PITR configuration is verified at every quarterly test. A regression that disables PITR is a Sev1.

### 4.2 Evidence store — Cloudflare R2

**Mechanism**: daily snapshot. The compliance collector (per `compliance/SELF_BUILT_SETUP.md`) writes a daily snapshot of the `compliance/` tree, the policy library, the audit log export, and the vendor SOC 2 reports to R2. R2 versioning is enabled.

**What it covers**: audit evidence, policy versions, weekly monitoring digests, vendor security reports, the Sentry export, the GitHub export.

**Cadence**: daily. The R2 lifecycle policy moves objects to the `cold` storage class after 90 days.

**Offsite**: R2 is multi-region by default via Cloudflare's edge network. The bucket is replicated across at least two Cloudflare regions; a regional outage does not lose the data.

**Verification**: the daily snapshot is verified for completeness (file count, total size) by the collector. A snapshot that is missing or partial triggers a Sev3 alert.

### 4.3 Deployment configuration

**Mechanism**: vendor-native versioning.

- **Vercel**: every deploy is retained; rollback to any prior deploy is one click.
- **Render**: every deploy is retained; rollback to any prior deploy is one click.
- **Neon**: the project configuration is captured in the project metadata and in the PITR backups.
- **Cloudflare**: DNS records are versioned in Cloudflare's audit log; WAF rules are versioned in the Cloudflare dashboard. R2 versioning is enabled on the evidence bucket.
- **GitHub**: branch protection, secrets, and environments are versioned in the GitHub audit log; the GitHub collector captures the daily state.

**Cadence**: continuous (every change is versioned by the vendor).

**Verification**: the deployment configuration is captured in the weekly digest. A regression that disables a security control (e.g. branch protection) is a Sev2.

### 4.4 SAM2 service state

**Mechanism**: Render deploy retention. The ONNX INT8 model weights and the service configuration are part of the deploy artifact. A redeploy from the previous artifact is one click.

**Cadence**: per deploy.

**Cold start**: the SAM2 service may auto-sleep after 15 minutes of inactivity on the Render free tier; this is documented in `audit_security_migrations` §4.4. The recovery is a cold start, which is part of the 4-hour RTO.

**Verification**: the cold-start time is measured in the quarterly restore test.

### 4.5 What is not backed up

- **Read-only replicas** — not currently in use. If added, they are covered by PITR automatically.
- **Ephemeral build artifacts** — not retained. The deploy is the artifact.
- **Customer browser state** — not retained. The customer re-authenticates.

## 5. Backup verification

A backup that has never been restored is a hope, not a backup. Solarpro verifies backups on three cadences.

### 5.1 Weekly — backup existence and integrity

**Owner**: Cody (operator) + Raymond (reviewer).

**What it covers**:

- The Neon PITR configuration is still enabled and the window depth is ≥7 days.
- The R2 evidence bucket is reachable; the most recent daily snapshot is present and complete.
- The Vercel and Render deploy histories are present (the previous N deploys are visible).
- The Cloudflare R2 versioning is enabled.
- The GitHub branch protection is still in effect.

**Output**: a one-line entry in the weekly monitoring digest at `compliance/monitoring/YYYY-WW-digest.md`. Anomalies are flagged.

**Time**: 15 minutes.

### 5.2 Quarterly — full restore test

**Owner**: Raymond (CISO) + Cody (technical lead).

**What it covers**: a real restore of the production database to a non-production environment, plus a real Vercel + Render redeploy to a staging environment, plus a real R2 inventory check.

**Procedure**:

1. Provision a non-production Neon project (or use the existing staging project).
2. Use Neon PITR to restore the production database to a point 24 hours before the test.
3. Verify row counts against the production database (within 1% tolerance for in-flight transactions).
4. Verify the audit log is intact (spot-check 10 random events; confirm `request_id` continuity).
5. Redeploy the Next.js app to a Vercel preview pointing at the restored database.
6. Run a smoke test of the top 5 customer flows (login, project list, survey submit, proposal create, admin login).
7. Redeploy the SAM2 service to a Render preview.
8. Run a smoke test of the SAM2 inference path.
9. Inventory the R2 evidence bucket; confirm the last 30 days of snapshots are present.
10. Document the actual RTO and RPO achieved.

**Output**: a quarterly restore test report at `compliance/monitoring/<quarter>-restore-test.md`. The report includes: the achieved RTO, the achieved RPO, the diff from the targets in §3, and any action items.

**Time**: 4 hours of focused work, scheduled on a Tuesday morning to minimize customer impact.

**Frequency**: every quarter. The first test is in Q3 2026 (90 days after this policy takes effect).

### 5.3 Annual — disaster recovery exercise

**Owner**: Raymond + James + Cody.

**What it covers**: a tabletop walkthrough of a full-stack outage scenario. The scenario is designed to exercise the BC/DR Plan (when it is written) and the comms plan in the Incident Response Plan.

**Output**: an exercise report at `compliance/incidents/<date>-dr-tabletop.md`.

**Frequency**: annually. Combined with the Incident Response Plan tabletop.

## 6. The recovery runbook

The runbook is the step-by-step for the most likely recovery scenarios. The runbook lives at `compliance/runbooks/recovery/` and is referenced from this policy.

### 6.1 Database restore (Neon PITR)

1. Confirm the incident with Raymond (or whoever is IC).
2. Open the Neon dashboard for the production project.
3. Select "Restore" → "Point in time" → choose the target timestamp (the moment before the incident).
4. Neon provisions a new project from the restore. This is the staging copy.
5. Verify the row counts and audit log integrity (per §5.2 step 3-4).
6. If the restore is correct, swap the DATABASE_URL in Vercel to point at the restored project. The application reconnects.
7. If the restore is incorrect, restore to a different timestamp and repeat.
8. Document the restore in the incident file. The PITR operation itself is logged in `auditLog.ts`.

**Time**: 30-90 minutes for the restore; 15 minutes for the swap; 30 minutes for the smoke test. Total: 1-2 hours, well inside the 4-hour RTO.

### 6.2 Vercel rollback

1. Open the Vercel dashboard for the Solarpro project.
2. Select "Deployments" → choose the previous successful deploy.
3. Select "Promote to Production."
4. Verify the rollback in production with a smoke test.

**Time**: <5 minutes. Well inside the 4-hour RTO.

### 6.3 Render rollback

1. Open the Render dashboard for the SAM2 service.
2. Select "Events" → choose the previous successful deploy.
3. Select "Rollback to this deploy."
4. Verify the SAM2 service responds to a smoke-test inference request.

**Time**: <5 minutes for the rollback; 15 minutes for the cold start. Total: <20 minutes.

### 6.4 Evidence store reconstruction

1. Open the R2 dashboard.
2. Inventory the most recent daily snapshots.
3. If the bucket is lost, recreate it from the versioned copies (R2 versioning preserves deleted objects for the configured retention).
4. Re-run the daily collector to repopulate the current day's snapshot.

**Time**: 1-2 hours, well inside the 24-hour RTO.

## 7. The 7-year retention floor

Audit evidence is retained for **7 years** from the date of creation. This applies to:

- The audit log (`audit_log` table in Neon, exported to R2 at the warm-tier transition).
- Policy versions (in git history).
- Vendor SOC 2 reports (in R2).
- The weekly monitoring digests.
- The quarterly restore test reports.

The 7-year floor is set by SOC 2 and ISO 27001 audit-record expectations. It is the most conservative practical number. The Data Classification & Handling Policy §6.1 sets the matching retention for customer data; the two are coordinated.

## 8. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Approves restore-test reports. Approves any change to the recovery targets. |
| **Technical lead** | **Cody** | Operates the backup and restore procedures. Runs the weekly backup existence check. Co-runs the quarterly restore test. |
| **Management sign-off** | **James Carpenter** | Approves the annual DR exercise. Approves any change to the 7-year retention floor. |

A backup failure (the weekly check fails, the restore test fails, the PITR is disabled) is escalated to the IC per the Incident Response Plan. A restore that exceeds the RTO/RPO targets is a Sev2 incident with a written rationale for the deviation.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management.
- `compliance/policies/05-incident-response.md` — when a backup is needed.
- `compliance/policies/06-change-management.md` — when a backup-related change ships.
- `compliance/policies/10-vendor-risk-management.md` — vendor commitments (Neon PITR, R2 multi-region, Vercel/Render deploy retention).
- `compliance/CONTROL_MATRIX.md` — CC9.1, A.8.13 current state and evidence.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture, R2 bucket.
- `compliance/monitoring/` — weekly digests, quarterly restore test reports.
- `compliance/runbooks/recovery/` — step-by-step runbooks.
- `audit_security_migrations_2026-07-30.md` §4.4 — the PITR / SAM2 cold-start gaps this policy closes.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 4h/1h production RTO/RPO, the 24h full-stack RTO, the three-cadence verification (weekly existence / quarterly full restore / annual DR exercise), the seven-year retention floor, and the four runbooks (Neon PITR, Vercel rollback, Render rollback, R2 reconstruction). |
