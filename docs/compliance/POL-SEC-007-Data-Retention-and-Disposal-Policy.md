# POL-SEC-007 — Data Retention & Disposal Policy

**Document ID:** POL-SEC-007  
**Version:** 1.0  
**Effective Date:** July 2025  
**Review Cadence:** Annual  
**Owner:** Security Lead  
**Approved By:** Leadership  

---

## 1. Purpose

This policy establishes the retention periods, storage requirements, and disposal procedures for all data types within SolarPro. Proper data retention and disposal ensures compliance with legal obligations, minimizes the risk surface by reducing stored sensitive data, controls storage costs, and supports SOC 2 and ISO 27001 compliance objectives.

The fundamental principle of data retention is: **retain only what is necessary, for only as long as necessary, and dispose of it securely when no longer needed.**

## 2. Scope

This policy applies to all data created, received, processed, stored, or transmitted by SolarPro, regardless of:

- Format (digital, physical)
- Location (production databases, backups, logs, local devices, cloud services)
- Classification tier (per POL-SEC-004)
- Storage medium (Neon PostgreSQL, Vercel blob storage, Sentry, GitHub, email, local filesystem)

## 3. Data Retention Schedule

### 3.1 Application Data (Neon PostgreSQL)

| Data Category | Examples | Retention Period | Justification |
|---------------|----------|------------------|---------------|
| Active customer accounts | User profiles, preferences | Duration of contract + 30 days | Business need; contract obligation |
| Deactivated customer accounts | Canceled subscriptions | 90 days post-deactivation | Recovery window; then anonymize |
| Project/engineering data | Plans, solar designs, calculations | Duration of contract + 1 year | Regulatory; client may need reference |
| Financial transaction records | Invoices, payment records | 7 years | Tax and regulatory compliance |
| Billing history | Subscription changes, credits | 7 years | Financial audit requirement |
| Customer support records | Tickets, communications | 3 years | Dispute resolution; quality improvement |
| Usage analytics | Feature usage, session data | 2 years | Product improvement; then aggregate |
| Marketing data | Leads, campaign results | 2 years | Marketing effectiveness analysis |

### 3.2 System and Security Data

| Data Category | Examples | Retention Period | Justification |
|---------------|----------|------------------|---------------|
| Audit logs | Access logs, change logs | 3 years | SOC 2 evidence; incident investigation |
| Security event logs | Auth failures, rate limit hits | 1 year | Security monitoring; trend analysis |
| Application error logs | Sentry exceptions | 90 days | Debugging; performance monitoring |
| API request logs | Request/response metadata | 90 days | Debugging; abuse investigation |
| Infrastructure logs | Vercel deployment logs | 90 days | Operational troubleshooting |
| Incident records | Incident reports, post-mortems | 5 years | Legal protection; pattern analysis |

### 3.3 Corporate and Compliance Data

| Data Category | Examples | Retention Period | Justification |
|---------------|----------|------------------|---------------|
| Employee records | HR files, performance reviews | 7 years post-termination | Legal requirement |
| Contracts and agreements | Vendor contracts, customer MSAs | 7 years post-expiration | Legal and audit requirement |
| Policy documents | Security policies, procedures | Indefinite (versioned) | Compliance evidence; audit trail |
| Risk assessments | Risk register entries | 5 years | Trend analysis; audit evidence |
| Access reviews | Quarterly review records | 3 years | SOC 2 evidence |
| Training records | Security awareness completion | 3 years | Compliance evidence |

### 3.4 Source Code and Development

| Data Category | Examples | Retention Period | Justification |
|---------------|----------|------------------|---------------|
| Source code (active repos) | All production code | Indefinite (versioned in Git) | Business continuity |
| Abandoned branches | Stale feature branches | 180 days | Cleanup; then delete |
| CI/CD build artifacts | Vercel preview deployments | 30 days | Storage optimization |
| Development databases | Seeds, test fixtures | Indefinite (if no PII) | Development efficiency |
| Secret rotation records | Key rotation history | 2 years | Audit trail |

### 3.5 Third-Party Service Data

| Service | Data Held | Retention | Notes |
|---------|-----------|-----------|-------|
| Stripe | Payment records, customer cards | Per Stripe's retention (7 years) | SolarPro cannot delete; request removal |
| Sentry | Error events, breadcrumbs | 90 days (Sentry retention setting) | Configure Sentry project retention |
| Resend | Email delivery records | 30 days (Resend default) | No PII stored beyond delivery metadata |
| Anthropic/OpenAI | API request/response | 0 days (no-log API flag) | Ensure zero-data-retention is enabled |
| GitHub | Source code, PRs, issues | Indefinite | Repository data; Git history |
| Vercel | Deployment logs, analytics | 90 days (Vercel plan) | Configure retention in project settings |

## 4. Data Disposal Procedures

### 4.1 Digital Data Disposal

Data classification determines the disposal method:

| Classification | Disposal Method | Verification |
|----------------|-----------------|--------------|
| **Restricted (Tier 1)** | Cryptographic erasure or secure overwrite (DoD 5220.22-M) | Verify key destruction or overwrite completion |
| **Confidential (Tier 2)** | Secure delete (overwrite then delete) | Confirm deletion from primary + backup systems |
| **Internal (Tier 3)** | Standard delete from primary storage | Confirm primary storage deletion |
| **Public (Tier 4)** | Standard delete | No verification required |

### 4.2 Database Record Disposal

For records in Neon PostgreSQL:

1. **Anonymization (preferred for analytics retention):** Replace PII fields with irreversible pseudonyms. Ensure no re-identification is possible. Record the anonymization event in the audit log.

2. **Hard deletion (required for right-to-delete requests):** Execute `DELETE` on the target records. Verify cascade deletion of related records. Force a `VACUUM FULL` on affected tables to ensure physical removal from disk. Log the deletion with timestamp, requesting user, and records affected.

3. **Backup reconciliation:** Deletion from the production database does not immediately remove data from backups. Mark records for exclusion during next backup rotation. Backups containing deleted data age out according to the backup retention schedule (see Section 5).

### 4.3 File and Object Storage Disposal

- Delete objects from Vercel Blob Storage / Google Cloud Storage
- Verify deletion via API (list objects, confirm absence)
- For Restricted data: destroy the encryption key (cryptographic erasure) if data was encrypted with a dedicated key

### 4.4 Physical Media Disposal

- Hard drives: Secure overwrite (minimum 3 passes) or physical destruction (shredding)
- Paper documents containing Confidential or Restricted data: Cross-cut shredding (minimum P-3 security level per DIN 66399)
- Record disposal in asset disposal log

## 5. Backup Retention and Disposal

| Backup Type | Retention | Disposal |
|-------------|-----------|----------|
| Daily incremental | 30 days | Automatic rotation |
| Weekly full | 90 days | Automatic rotation |
| Monthly full | 1 year | Automatic rotation |
| Annual archive | 3 years | Manual deletion with verification |

Backups containing data subject to deletion requests must be flagged. The data will be removed during the next backup restoration cycle, or the backup may be selectively purged if the platform supports it.

Neon PostgreSQL point-in-time recovery retains WAL segments for 7 days by default. Ensure Neon's retention setting aligns with this policy.

## 6. Data Subject Request Handling

### 6.1 Right to Access (GDPR/CCPA)

Upon verified request from a data subject:
1. Identify all data belonging to the subject across all systems
2. Compile the data in a portable format (JSON or CSV)
3. Deliver via secure channel (encrypted email or download link)
4. Complete within 30 days of verified request
5. Log the request and fulfillment in the audit trail

### 6.2 Right to Deletion (GDPR/CCPA)

Upon verified deletion request:
1. Confirm the request is from the data subject or authorized representative
2. Check legal retention obligations (e.g., financial records must be retained for 7 years regardless)
3. Where deletion is permissible, execute hard deletion per Section 4.2
4. Where deletion conflicts with legal retention, restrict processing and inform the data subject
5. Notify third-party processors (Stripe, etc.) of the deletion request
6. Confirm deletion and notify the data subject within 30 days
7. Log the request, actions taken, and completion in the audit trail

## 7. Retention Policy Enforcement

### 7.1 Automated Enforcement

- Database retention policies should be enforced via scheduled jobs (cron or Vercel Cron Jobs)
- Implement automated cleanup scripts for each data category
- All automated deletions must be logged with: timestamp, data category, records affected, verification status

### 7.2 Manual Review

- Quarterly review of retention compliance by Security Lead
- Annual review of retention periods to ensure alignment with current legal requirements
- Document any exceptions with justification and Leadership approval

### 7.3 Legal Hold

When litigation, audit, or investigation is reasonably anticipated:
1. Leadership or Legal issues a legal hold notice
2. All disposal of potentially relevant data is suspended
3. Legal hold supersedes retention schedules until released by Leadership
4. Security Lead maintains a legal hold register with: hold date, scope, issuing authority, release date

## 8. Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| Leadership | Approve retention periods; authorize legal holds; approve exceptions |
| Security Lead | Maintain retention schedule; enforce disposal; review compliance |
| Engineering | Implement automated retention enforcement; execute technical disposal |
| All Personnel | Report data that may exceed retention; follow disposal procedures |

## 9. Metrics and Monitoring

| Metric | Target | Frequency |
|--------|--------|-----------|
| Records past retention not yet disposed | < 5% of total | Monthly |
| Deletion requests completed within 30 days | 100% | Per request |
| Backup rotation compliance | 100% | Weekly |
| Legal hold register currency | 100% current | As needed |
| Anonymization verification | 100% pass | Quarterly |

## 10. Related Documents

- POL-SEC-001 — Information Security Policy
- POL-SEC-004 — Data Classification Policy
- POL-SEC-008 — Vendor Risk Management Policy
- POL-SEC-010 — Encryption Policy

---

*This policy is subject to annual review. The Security Lead is responsible for ensuring retention periods remain aligned with applicable laws, regulations, and contractual obligations.*
