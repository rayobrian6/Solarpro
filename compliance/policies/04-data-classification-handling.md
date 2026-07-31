# Data Classification & Handling Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-003 — Data Classification & Handling Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All data held by Solarpro, in any system, in any form (production, non-production, backup, log, screen, paper). |

---

## 1. Purpose

This policy classifies every piece of data Solarpro holds and says how each class must be handled — labeled, stored, transmitted, retained, and disposed of. It's the **SOC 2 CC6.7 / CC6.8 + ISO 27001 A.5.12 / A.5.13 + ISO 27701 PII** evidence.

If you don't know which class a piece of data is in, **default to the most restrictive class that could apply** and ask Raymond.

## 2. Data classes

Four classes, in increasing order of restrictiveness.

### 2.1 Public

Information Solarpro publishes intentionally and wants anyone to see. Examples: marketing site copy, the `/trust` page, published SOC 2 reports (after Type 1 lands), the public GitHub repo (where applicable), open-source dependencies.

**Handling rules:**

- No restrictions on sharing, storage, or transmission.
- If something is published and later found to be wrong, correct it and note the correction (no silent edits).

### 2.2 Internal

Information intended for Solarpro team use but not for customers or the public. Examples: this policy set, internal Slack history, internal Linear issues, internal OKRs, draft blog posts, the `auditLog.ts` table.

**Handling rules:**

- Don't share outside the company without a reason.
- OK to discuss in Slack, store in Google Drive (Workspace account required), commit to private GitHub repos.
- Don't post in public forums, support tickets, or social media.

### 2.3 Confidential

Information that would cause real harm if disclosed. Examples: source code for unreleased features, financial records, internal audit reports, the four 2026-07-30 audit reports that drove the gap assessment, vendor contracts and pricing.

**Handling rules:**

- Access on a need-to-know basis.
- Encrypted at rest (Neon default) and in transit (TLS 1.2+).
- Never sent to personal email, personal cloud drives, or AI tools without an approved exception.
- Disposed by secure deletion (see §6).

### 2.4 Restricted

Information whose disclosure would cause regulatory, legal, or material reputational harm. Includes PII, credentials, payment data, and security keys.

| Sub-class | Examples | Specific rules |
|---|---|---|
| **PII — homeowner** | Name, address, phone, email, photos of the home, roof measurements derived from photos | Field-level length caps on input. Photos stripped of EXIF (GPS, device, timestamp) on upload. No transit to AI vision APIs without a DPA on file (currently: OpenAI and Anthropic DPAs are pending — P0 in the matrix). |
| **PII — inspector** | Name, email, phone, company, license number (if collected) | Field-level length caps. Not sent to vision APIs. Retained per §6. |
| **Payment data** | Card numbers, bank accounts, ACH details | **Never touches Solarpro systems.** All payment processing is delegated to Stripe (PCI DSS Level 1). Solarpro stores only Stripe customer IDs and last-4 references. |
| **Credentials** | API keys, JWT secrets, MFA seeds, database passwords, OAuth refresh tokens, HMAC webhook secrets | Stored in GitHub Actions encrypted secrets or Vercel/Render/Neon encrypted env vars. Never in source code, never in `.env` files committed to git, never in Slack or email. 32-character minimum for any high-entropy secret. |
| **Security telemetry** | Sentry events, audit log entries, Dependabot alerts, secret-scanning alerts | May incidentally contain PII. Sentry has PII scrubbing enabled. Audit log access is admin-only. |

**Handling rules (all Restricted sub-classes):**

- Access logged to `auditLog.ts` on read where the system supports it.
- Encrypted at rest (Neon AES-256) and in transit (TLS 1.2+).
- Production data does not appear in non-production environments unless the data is fully synthetic or the test has been approved by Raymond with a documented scope.
- Disposal by cryptographic erasure (key destruction) for encrypted data, or by secure deletion (NIST 800-88) for backups.
- Breach triggers the Incident Response Plan and, for PII, the 72-hour breach notification clock (GDPR Art. 33; see the Data Subject Rights policy in Sprint 2 for the runbook).

## 3. Labeling

Labeling is at the discretion of the data owner, but the **absence of a label does not lower the class**. The default when in doubt is Restricted.

Where labels are required:

- **Spreadsheets and documents** that contain Confidential or Restricted data must have the class in the document title or header (e.g. `Q3 Financials — CONFIDENTIAL`).
- **Database columns** that hold PII are tagged in the schema with a comment naming the PII sub-class (a P1 remediation in flight).
- **Customer survey intake** fields are classified in the survey schema (the inspector PII fields are documented; the photo-handling fields are documented in `lib/survey/`).
- **Backups** inherit the class of the data they contain. The Neon backup bucket is treated as Restricted.

## 4. Storage and transmission

### 4.1 Storage

| Class | Approved storage |
|---|---|
| Public | Anywhere (Vercel CDN, GitHub public repos, marketing site CMS). |
| Internal | Google Workspace (Drive), private GitHub repos, Linear, Slack. |
| Confidential | Google Workspace (Drive), private GitHub repos, Linear (Private), R2 evidence bucket. |
| Restricted | Neon (encrypted at rest), GitHub Actions secrets, Vercel/Render/Neon env vars. **Never** in Google Drive, personal devices, or unsanitized backups. |

### 4.2 Transmission

- **All transmissions** of Restricted data use TLS 1.2 or higher. HTTP-only endpoints are not used for any data class.
- **Webhook deliveries** (Stripe, survey, Meta, Google, generic) are signed with HMAC SHA-256 + 5-minute timestamp tolerance, verified with `crypto.timingSafeEqual` to prevent timing attacks. Replay protection is via `webhook_deliveries.event_id` idempotency keys.
- **Customer → Solarpro**: survey upload uses authenticated session + per-survey photo count cap (Redis counter) + PII field length caps. EXIF stripped on upload.
- **Solarpro → sub-processor**: only with a signed DPA on file. Aerial photos and PII go to OpenAI, Claude, or Anthropic vision APIs **only when the DPA is in place**. Today (2026-08-15) the OpenAI and Anthropic DPAs are pending — see `compliance/vendors.csv`.
- **Solarpro → customer**: emails (Resend) are transactional, do not contain PII beyond what the recipient already provided, and are not used for marketing without consent.

## 5. Production data in non-production environments

This is the rule most often bent and the rule that lands you on the front page of the news. **Production data does not appear in non-production environments** except under the following conditions:

- The data is fully synthetic (no real customer identifiers, no real PII, no real photos). Synthetic data is documented in the test fixture with the date and generator.
- **OR** Raymond has approved a specific test that requires realistic data, the data scope is documented in a Linear issue, and the test environment is destroyed within 30 days.

This rule applies to: local development databases, staging environments, CI fixtures, screenshot generation, training data for ML models, and demo accounts.

The audit `audit_security_migrations §2 #7` flagged that PII field length caps and per-survey photo count caps were missing on the survey upload. Both are remediated; this policy codifies the rule so the gap doesn't reopen.

## 6. Retention and disposal

### 6.1 Retention

| Data | Retention | Reason |
|---|---|---|
| Survey + planset (production data) | 7 years after last customer activity | Permit records; statute of limitations on engineering work |
| Customer PII not tied to a survey (e.g. support emails) | 3 years after last contact | Customer service continuity |
| Audit log (`auditLog.ts`, MIGRATION-GOV-13) | 7 years hot + indefinite cold | SOC 2 + ISO 27001 A.5.28 (forensic readiness) |
| Application logs (Sentry) | 90 days | Operational debugging |
| Backup snapshots (Neon PITR) | 7 days (PITR window) | Recovery only; rotated |
| Evidence objects in R2 | 90 days hot, then Infrequent Access, 7-year total | SOC 2 + ISO 27001 |
| Webhook delivery records | 1 year | Replay / fraud investigation |
| Session tokens, password reset tokens | 24 hours after issue | Operational |
| JWT refresh tokens | 30 days | Operational |

A separate **Data Retention & Disposal Policy** (Sprint 2) will document the deletion procedures, including Neon scheduled deletion jobs, the Sentry scrubbing cadence, and the Google Workspace retention rules.

### 6.2 Disposal

- **Digital records**: secure deletion (NIST 800-88 Clear or Purge) for files; cryptographic erasure (destruction of the encryption key) for encrypted data.
- **Backups**: included in the cryptographic erasure of the parent dataset.
- **Paper** (rare): cross-cut shredding. Solarpro does not currently produce paper records of Restricted data.
- **Devices**: wiped to factory reset before disposal or return. The Google Workspace admin can remote-wipe a stolen device.
- **Customer-initiated deletion**: handled by the Data Subject Rights Policy (Sprint 2) within the GDPR Art. 17 + CCPA timelines.

## 7. PII handling (ISO 27701 specifics)

Solarpro is a **PII controller** for homeowner and inspector data (the survey intake flow). Solarpro is a **PII processor** for utility and AHJ data resolved on behalf of customers.

The PII-specific rules:

- **Lawful basis** (to be documented in the Privacy Impact Assessment, Sprint 2): contract performance for survey processing; legitimate interest for security and fraud prevention; consent for any marketing communication.
- **Data minimization**: only fields that the engineering pipeline actually needs are collected. If a field is not used in the plan-set, BOM, permit, or audit trail, it is removed from the schema.
- **Sub-processors** (third parties that receive PII): listed in `compliance/vendors.csv`. DPAs are required for any sub-processor that receives PII. The P0 gaps for OpenAI and Anthropic are tracked in the vendor register.
- **Cross-border transfer**: Solarpro's primary infrastructure is US-based. EU customer data, if any, is governed by the Standard Contractual Clauses in the customer DPA.
- **PII breach notification**: 72 hours to the supervisory authority, 30 days to the data subject if the breach is high-risk to their rights. The Incident Response Plan (§5) is the operational hook.

## 8. Enforcement

A data handling violation is a security incident. The classification, escalation, and post-incident review all follow the Incident Response Plan. Unauthorized exfiltration of Restricted data is treated as a Sev1.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation.
- `compliance/policies/03-access-control.md` — who can access what.
- `compliance/policies/05-incident-response.md` — what to do on a breach.
- `compliance/vendors.csv` — sub-processor list and DPA status.
- `compliance/CONTROL_MATRIX.md` §A.5.34, §6.x — PII control mapping.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the four-class scheme (Public / Internal / Confidential / Restricted) and the production-in-non-production rule that was previously implicit. |
