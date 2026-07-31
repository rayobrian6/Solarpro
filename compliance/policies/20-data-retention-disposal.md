# Data Retention & Disposal Policy

| Field | Value |
|---|---|
| **Policy** | POL-PRV-003 — Data Retention & Disposal Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new data category, new regulator guidance, new legal hold) |
| **Scope** | Every piece of data Solarpro holds on behalf of itself, its customers, and its customers' end users. Production data, audit logs, backups, evidence store, subprocessor-held copies, and the on-disk artifacts of any system that processes customer data. |

---

## 1. Purpose

This policy is the rule for **how long Solarpro keeps data, and how Solarpro deletes it when the time comes**. It's the **SOC 2 CC6.5 (Discontinues logical and physical protection only when no longer required) + ISO 27001 A.5.34 (Privacy and protection of PII) + ISO 27001 A.8.10 (Information deletion) + ISO 27701 6.7 (PII de-identification) + ISO 27701 6.8 (PII controller / processor obligations) + GDPR Article 17 (Right to erasure)** evidence: that Solarpro retains data only as long as needed for the documented purpose, deletes data when the purpose ends, and applies proportionate disposal methods that prevent recovery by an unauthorized party.

The auditor's question is not "do you delete data?" — it's "do you know what you have, how long you've had it, when you're supposed to delete it, and how you prove it's gone?" This policy answers each of those questions with a retention schedule (§3), a deletion trigger (§4), a disposal method (§5), a verification procedure (§6), and the exceptions that override the schedule (§7).

The principle: **the data's purpose, not the system's convenience, drives the retention.** A database row is retained because the business purpose is still active, not because the row happens to exist in a table that is never cleaned up. A backup is retained because the disaster-recovery window is still active, not because the backup process has never been tuned. A log is retained because the audit window is still active, not because the log has never been rotated.

## 2. Scope

This policy applies to every data artifact in the Solarpro stack:

- **Production database** — Neon Postgres. The source of truth for account, project, survey, proposal, permit, document, audit log, webhook, and billing data.
- **Object storage** — the photo and document blobs in the production database's `bytea` columns (today) or in a future object store (forthcoming). The disposal method differs by storage type; see §5.
- **Application logs** — the structured logs produced by the Next.js application and the SAM2 service. Logs that may contain PII (per the Data Classification & Handling Policy §2.4) are within scope.
- **Audit log** — the `auditLog.ts` table, the `MIGRATION-GOV-13` migration log, and the GitHub Actions audit log (when accessible via the API).
- **Backups** — Neon PITR (7-day window) and any future backup system. Backups are a special retention class because the data in them ages out by the backup window, not by a row-level delete.
- **Evidence store** — the git repo at `compliance/evidence/`. The retention is separate (the evidence is retained for the audit lifecycle, not the data lifecycle).
- **Subprocessor-held copies** — every copy of Solarpro data held by a subprocessor (Vercel, Neon, Render, OpenAI, Anthropic, Google, Stripe, Resend). The deletion is by subprocessor notification, not by Solarpro-side action.
- **Customer support correspondence** — the support email history in Google Workspace and any support-ticket system.
- **Customer-requested exports** — the JSON exports produced for data-subject access / portability requests (per POL-PRV-002 §3.3.1 and §3.3.5). The export itself is retained for 7 days (the signed-URL window) and then auto-deleted from the export storage.

**Out of scope:**

- **Public information** (the marketing site, the public docs, the published Trust Center) — no retention schedule; the public site is the source.
- **Anonymized aggregate data** — once data is anonymized to the standard in §5.4, it is no longer personal information and is retained per the analytics policy (forthcoming), not this one.
- **Internal policies, code, and infrastructure configuration** — retained per the Engineering / Documentation policy, not this one.
- **Tax and accounting records** — retained for 7 years per the IRS and state tax codes. These are corporate records, not customer data; they are out of scope for the customer-facing retention but in scope for the corporate retention.

## 3. The retention schedule

The schedule below is the source of truth. The schedule is reviewed annually and on material change. Every row in the schedule is backed by a documented business purpose (the "Why" column) and a documented disposal method (§5).

| Data category | Active retention | Post-event retention | Why | Disposal method |
|---|---|---|---|---|
| **Account record** (the `users` table row) | For the life of the account | 30 days after account closure (grace period), then hard delete | Service operation; grace period for reactivation | Hard delete (§5.1) |
| **Account credentials** (bcrypt hash, MFA seeds) | For the life of the account | 30 days after account closure, then hard delete | Authentication | Hard delete |
| **Organization / membership** (the `organizations`, `organization_members` tables) | For the life of the organization | 30 days after organization dissolution, then hard delete | Service operation; multi-tenancy | Hard delete |
| **Projects, surveys, plan-sets, BOMs, documents** | For the life of the account + 7 years after last activity | The 7 years is the permit / warranty retention; after 7 years, hard delete | Permit records, warranty, audit, legal-defence preservation | Hard delete |
| **Photos and aerial imagery** | For the life of the survey + 7 years after last activity | Same as above; 7 years is the retention floor | Same as above; photos are inputs to the engineering output | Hard delete + cryptographic shred of any encrypted backup (§5.3) |
| **Inspector notes, GPS coordinates, site conditions** | For the life of the survey + 7 years | Same as above | Same as above; these are engineering inputs | Hard delete |
| **Utility data (account number, usage history, tariff)** | For the life of the survey + 7 years | Same as above | Same as above | Hard delete + subprocessor notification |
| **Billing records (invoices, payment events, Stripe customer ID)** | 7 years after the transaction | n/a (the 7 years is the floor) | Tax law (IRS 7-year retention), accounting law, audit | Hard delete after 7 years; subprocessor notification to Stripe |
| **Audit log** (`auditLog.ts`, `MIGRATION-GOV-13`) | **90 days hot** (production), **1 year warm** (read-only archive), **7 years cold** (encrypted R2-archive, retrieval only on request) | n/a (the 7 years is the floor) | SOC 2 audit, incident investigation, regulator inquiry, legal-defence preservation | Cryptographic shred at the end of cold retention (§5.3) |
| **Application logs** (structured logs from the Next.js and SAM2 services) | **30 days hot** (in the log store), then aggregate-only (PII removed) | Aggregate-only logs retained for 1 year | Operational monitoring, debugging, security | Aggregate-only (PII scrubbed) after 30 days; hard delete after 1 year |
| **Sentry events** | **90 days** (Sentry default), then aggregate-only | Aggregate-only retained per Sentry's plan | Error monitoring, debugging | Hard delete after 90 days via the Sentry API |
| **Backups** (Neon PITR, 7-day window) | **7 days rolling**, then aged out | n/a (the 7 days is the disaster-recovery window) | Disaster recovery | Aged out automatically by Neon |
| **Customer support correspondence** | **2 years** after the last interaction, then aggregate-only (PII removed) | Aggregate-only retained for 1 year | Support history, training, recurring-issue analysis | Aggregate-only (PII scrubbed) after 2 years; hard delete after 3 years |
| **Marketing / consent records** (the `email_preferences` table) | For the life of the account + 30 days after closure | n/a (deleted with the account record) | Consent tracking, GDPR Art. 7(1) | Hard delete |
| **Customer-requested exports** (the JSON files generated for POL-PRV-002 access / portability requests) | **7 days** (the signed-URL window), then auto-delete | n/a | The export is a one-time delivery; long-term retention is the underlying source data | Auto-delete from the export storage after 7 days |
| **Subprocessor-held copies** | Per the subprocessor's own retention (governed by the DPA) | Per the DPA's data-return-and-deletion clause | The subprocessor is bound by the DPA; the deletion is by subprocessor notification | Subprocessor notification + written confirmation |
| **DPO / supervisory authority correspondence** | **7 years** | n/a | GDPR accountability, audit | Hard delete after 7 years |
| **DPIA / PIA records** | **7 years** after the assessment is superseded | n/a | GDPR Art. 35(11), ISO 27701 | Hard delete after 7 years |
| **Background check records** | **7 years** after the employment / engagement ends | n/a | HR retention, EEOC | Hard delete after 7 years |
| **Security questionnaires and vendor reviews** | **7 years** after the last review | n/a | Vendor management, audit | Hard delete after 7 years |

The retention schedule is the **SOC 2 CC6.5 + ISO 27001 A.5.34 + ISO 27001 A.8.10** evidence. Every data category has a documented purpose, a documented retention window, and a documented disposal method. An auditor can pick any category, ask "why this long?", and get a one-sentence answer from this table.

## 4. Deletion triggers

A retention period ends in one of four ways. The trigger determines which deletion process applies.

### 4.1 Trigger 1 — Account closure

A Solarpro account is closed when:

- The account holder closes the account via the account settings page.
- The account holder requests closure by emailing `privacy@solarpro.app` (or `support@solarpro.app`).
- The account is closed by an organization owner (for organization-member accounts).
- The account is closed by Solarpro for a policy violation, a payment failure after the dunning cycle, or a security incident (the last under the Incident Response Plan, POL-OP-002).

**Process:** the account record is soft-deleted immediately (a `deleted_at` timestamp is set); the underlying data rows in dependent tables are retained for the 30-day grace period (per §3); after 30 days, the soft-deleted rows are hard-deleted in a scheduled nightly job. The soft-delete-then-hard-delete pattern allows reactivation during the grace period (the account holder changes their mind).

**Notification:** the account holder is notified at closure and at the 25-day mark (5 days before hard delete). The notification is by email to the verified address on file. The notification is the **ISO 27701 6.8.4** evidence: that the data subject is informed of the pending deletion.

### 4.2 Trigger 2 — Inactivity (2 years)

A Solarpro account is considered inactive when the account holder has not logged in for **2 years**. The inactivity window starts at the last login.

**Process:** 90 days before the inactivity-based deletion (i.e. at 2 years minus 90 days = ~21 months of inactivity), the account holder is sent a "your account is about to be deleted" email. The email includes the deletion date, the data that will be deleted, the right to log in to prevent the deletion, and the right to request a data export before the deletion. If the account holder does not log in within the 90-day notice window, the account is treated as closed (per §4.1) and the §3 schedule applies.

**Why 2 years + 90 days:** the 2-year inactivity window is the operational definition of "no longer a customer." The 90-day notice is the grace period. The numbers are calibrated to be longer than the typical 18-month churn window for a B2B SaaS and short enough to comply with the storage-limitation principle in GDPR Art. 5(1)(e).

**Excluded from inactivity-based deletion:**

- Accounts with an active legal hold (§7.1).
- Accounts with an active subscription (a paid subscription is treated as an active relationship, even if the user has not logged in).
- Accounts that are the only admin of an organization with other active members (the deletion is paused until the organization is dissolved or a new admin is appointed).

### 4.3 Trigger 3 — End of the retention period

A data category reaches the end of its retention period per the §3 schedule. The trigger is silent (no customer-facing event); the deletion is by the scheduled job that runs the retention logic.

**Process:** the scheduled retention job runs nightly. The job identifies data categories that have exceeded their retention period and queues them for hard delete. The job is idempotent (running it twice has the same effect as running it once). The job logs every deletion in `auditLog.ts` with the data category, the count, the timestamp, and the run ID.

### 4.4 Trigger 4 — Customer-requested deletion (GDPR Art. 17, CCPA § 1798.105)

A data subject requests deletion under the data-subject rights process in POL-PRV-002 §3.3.3. The deletion is performed within the SLA (15 business days for production, 30 days for subprocessor confirmation), and the exceptions in POL-PRV-002 §3.3.3 (legal obligation, public interest, legal claims, contract performance, anonymized aggregate, manifestly unfounded) apply.

**Process:** the same hard-delete + subprocessor-notification flow as the other triggers, but the SLA is tighter (15 business days vs. 30 days for the scheduled job), the data subject is informed at every step, and the deletion confirmation is filed in the request register at `compliance/privacy/dsr-register-<year>.csv`.

## 5. Disposal methods

The disposal method depends on the storage type. The methods below are the **SOC 2 CC6.5 + ISO 27001 A.8.10 + ISO 27701 6.7** evidence: that Solarpro uses proportionate disposal methods that prevent recovery by an unauthorized party.

### 5.1 Hard delete (database rows and object blobs)

For data in the production database (Neon Postgres) and any object storage:

- **Database rows**: `DELETE FROM <table> WHERE <condition>;` followed by `VACUUM FULL` on the table to reclaim the disk space. The VACUUM is a Neon-maintenance operation; the soft-delete-then-hard-delete pattern (per §4.1) is the standard flow.
- **Object blobs**: `DELETE FROM <object_table> WHERE <condition>;` for blobs stored as `bytea` in the database. The blob's disk space is reclaimed by the same VACUUM.
- **Verification**: after the hard delete, a verification query (`SELECT COUNT(*) FROM <table> WHERE <condition>;`) returns zero rows. The verification is logged in the audit log.

### 5.2 Aggregate-only (logs and support history)

For data that has a long-tail analytical value but does not need to retain PII:

- **Application logs**: after 30 days, the logs are processed by a PII-scrubbing job that replaces identifying fields (`user_id`, `email`, `name`, `ip_address`, `user_agent`) with `***` (the literal three-asterisk string). The aggregate-only logs are retained for 1 year.
- **Sentry events**: after 90 days, the Sentry retention policy is configured to delete events automatically. The deletion is by the Sentry API; the verification is a Sentry query that returns zero events in the deleted period.
- **Support correspondence**: after 2 years, the PII fields are scrubbed; the aggregate-only correspondence is retained for 1 year.

The PII-scrubbing job is the **ISO 27701 6.7.1** evidence: that personal information is de-identified when the purpose shifts from operational to analytical.

### 5.3 Cryptographic erasure (encrypted backups and encrypted evidence store)

For data that is stored encrypted (backups, evidence store, encrypted object storage):

- The data is encrypted with a per-class key (e.g. the production database's PITR backups are encrypted with the Neon-managed key; the evidence store is encrypted with the Cloudflare-managed key).
- "Deletion" by cryptographic erasure means **destroying the encryption key**, not the data. The encrypted data remains on the storage, but it is mathematically infeasible to decrypt without the key.
- The key destruction is logged in the audit log with the key ID, the destruction timestamp, and the cryptographic attestation (the key-management system provides a signed attestation that the key is destroyed).

Cryptographic erasure is the **ISO 27001 A.8.10 + ISO 27701 6.7.2** evidence: that personal information is rendered unrecoverable even when the physical storage is not erased.

### 5.4 Anonymization (for data that has long-term analytical value)

For data that Solarpro wants to retain beyond the retention period for legitimate analytical purposes (e.g. usage-pattern analysis):

- The data is anonymized by removing all direct identifiers (name, email, phone, address, account ID) and all indirect identifiers that could be combined to re-identify (IP, user agent, device fingerprint, GPS coordinates with high precision).
- The anonymization is irreversible: the anonymization is performed by a process that does not retain the mapping between the original data and the anonymized form.
- The anonymized data is no longer personal information and is out of scope for the retention schedule. The anonymization standard is documented in `compliance/privacy/anonymization-standard.md` (forthcoming).

### 5.5 Physical destruction (for hardware being decommissioned)

Solarpro is cloud-only and does not own the physical hardware. The physical destruction is the responsibility of the cloud provider (Vercel, Neon, Render, Cloudflare) and is governed by the provider's SOC 2 report. The physical destruction is therefore not in scope for this policy; the provider's commitment is reviewed annually as part of the Vendor Risk Management Policy (POL-VEN-001 §6).

## 6. Verification

Every deletion is verified. The verification is the **SOC 2 CC6.5 + ISO 27001 A.8.10** evidence: that Solarpro can prove the data is gone, not just claim it is.

### 6.1 The nightly retention job

The nightly retention job (§4.3) produces a deletion report at `compliance/retention/nightly-<YYYY-MM-DD>.json` with:

- The data categories processed.
- The rows deleted per category.
- The blobs deleted per category.
- The keys destroyed per category.
- The job's start and end timestamps.
- The job's exit status (success / partial / failure).
- The verification queries and their results.

The report is committed to the repo on the next morning. The report is the auditor's evidence for the scheduled retention.

### 6.2 The annual retention audit

Once a year (in Q1, as part of the SOC 2 audit prep), the entire retention schedule is audited:

- For each data category in §3, a representative sample of rows is checked to confirm the category is being retained for the documented period (not longer, not shorter).
- The audit is owned by Raymond. The audit produces a one-page summary at `compliance/retention/annual-audit-<year>.md` with the findings and any required corrections.
- The audit is the **ISO 27001 A.5.35 (Independent review)** evidence: that the retention schedule is reviewed by a person who does not own the day-to-day data lifecycle.

### 6.3 The data-subject rights verification

For customer-requested deletions (Trigger 4), the verification is per the Data Subject Rights Policy (POL-PRV-002 §3.3.3): the data subject is informed of the deletion, the subprocessor confirmations are tracked in the request register, and the deletion confirmation is filed.

## 7. Exceptions

### 7.1 Legal hold

If Solarpro receives a litigation hold, a regulatory preservation order, or a similar legal obligation to retain data that would otherwise be deleted, the deletion is paused for the affected data. The legal hold is documented in `compliance/retention/legal-holds/<case-id>.md` with the data scope, the legal basis, the hold start date, the expected hold end date, and the contact for the matter.

A legal hold overrides the retention schedule. The data subject is informed that the deletion is paused for the legal hold (unless the legal hold is sealed or the law specifically prohibits the notification). When the legal hold is released, the data is deleted per the retention schedule (the retention clock is not "reset" by the hold; the data is deleted as if the hold had not happened).

A legal hold is owned by James (with legal counsel as appropriate). The legal hold is reviewed quarterly. The legal hold is the **ISO 27001 A.5.29 + ISO 27701 6.8.7** evidence: that data is preserved when required by law, even when the retention period would otherwise have expired.

### 7.2 Anonymized aggregate data

Anonymized aggregate data (per §5.4) is out of scope for the retention schedule. The anonymization is irreversible; the data is no longer personal information.

### 7.3 Backups

Backup data is not selectively deleted. The backup ages out by the backup window (Neon PITR is 7 days; after 7 days, the data is no longer in any backup). The customer-facing commitment in the data-subject rights process (POL-PRV-002 §3.3.3) is "your data is deleted from production immediately and from backups within 7 days."

### 7.4 Other exceptions

Other exceptions to this policy follow the standard exception process in the Information Security Policy (POL-IS-001 §8): documented in a Linear issue tagged `compliance-exception`, approved by Raymond, disclosed to James if the exception involves a P0 control or a customer commitment.

## 8. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the nightly retention job output monthly. Owns the annual retention audit. Approves legal holds (with James). Approves the anonymization standard. |
| **Management sign-off** | **James Carpenter** | Approves the policy. Approves any deviation from the standard schedule. Owns the legal hold process (with legal counsel). |
| **Technical lead** | **Cody** | Owns the nightly retention job. Owns the PII-scrubbing job. Owns the cryptographic erasure tooling. Owns the verification queries. |
| **DPO / supervisory authority correspondent** | **Raymond O'Brien** (operational role) | Receives regulator inquiries about retention; coordinates with James. |

## 9. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/04-data-classification-handling.md` — the data classes that drive the retention schedule.
- `compliance/policies/05-incident-response.md` — when a data breach triggers retention / preservation changes.
- `compliance/policies/06-change-management.md` — when the retention schedule itself is changed.
- `compliance/policies/09-backup-recovery.md` — the backup policy that this policy references; the backup window is a retention trigger.
- `compliance/policies/10-vendor-risk-management.md` — the subprocessor relationships that this policy relies on for subprocessor deletion confirmations.
- `compliance/policies/16-third-party-service-provider.md` — the people-side deletion process for offboarding.
- `compliance/policies/18-privacy-policy.md` (POL-PRV-001) — the customer-facing retention summary.
- `compliance/policies/19-data-subject-rights.md` (POL-PRV-002) — the operational process for customer-requested deletion.
- `compliance/CONTROL_MATRIX.md` — CC6.5, A.5.34, A.8.10, 6.7, 6.8, GDPR Art. 17 current state and evidence.
- `compliance/retention/nightly-<YYYY-MM-DD>.json` — the nightly retention job output.
- `compliance/retention/annual-audit-<year>.md` — the annual retention audit.
- `compliance/retention/legal-holds/<case-id>.md` — the legal hold register.
- `compliance/privacy/dsr-register-<year>.csv` — the data-subject request register (which is the customer-requested deletion log).
- `compliance/privacy/anonymization-standard.md` — forthcoming anonymization standard.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Sets the retention schedule (§3) for every data category in Solarpro's stack (account, organization, project / survey / plan-set / BOM / document, photo, billing, audit log, application log, Sentry event, backup, support correspondence, marketing consent, customer-requested export, subprocessor copy, DPO correspondence, DPIA, background check, vendor review) with a documented business purpose and a documented disposal method per category. Defines four deletion triggers (§4): account closure (30-day grace), inactivity (2 years + 90-day notice), end of retention period (silent, scheduled), and customer-requested deletion (POL-PRV-002). Defines four disposal methods (§5): hard delete (database rows + blobs + VACUUM), aggregate-only (logs + support with PII scrub), cryptographic erasure (encrypted backups + evidence store by key destruction), and anonymization (irreversible for long-tail analytics). Defines the verification procedure (§6): the nightly retention job with a deletion report, the annual retention audit, and the data-subject rights verification (per POL-PRV-002). Defines the legal-hold exception (§7.1) with a per-case register. The schedule cross-references the Data Classification & Handling Policy (POL-IS-003) and the Backup & Recovery Policy (POL-OP-006) for the underlying data classes and backup windows. |
