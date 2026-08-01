# Data Subject Rights Policy

| Field | Value |
|---|---|
| **Policy** | POL-PRV-002 — Data Subject Rights Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new regulator guidance, new data category) |
| **Scope** | Every request from an individual (a "data subject" in GDPR terms) for access to, correction of, deletion of, restriction of, portability of, or objection to the processing of their personal information held by Solarpro. Includes requests from Solarpro account holders, the installer's staff, the homeowners whose properties appear in surveys, and any other individual whose information is in a Solarpro dataset. |

---

## 1. Purpose

This policy is the operational rule for **how Solarpro handles a data-subject rights request** — the access, correction, deletion, portability, restriction, objection, and consent-withdrawal rights that GDPR Articles 15-22 grant to EU data subjects, that CCPA § 1798.100-130 grant to California consumers, and that PIPEDA and equivalent laws grant elsewhere. It's the **ISO 27701 6.10 / 6.11 / 6.12 + GDPR Chapter III + CCPA § 1798.100-130** evidence: that Solarpro has a documented intake → verification → fulfillment → audit-log process for every data-subject right, with a known response SLA and a known escalation path.

The customer-facing promise is in the Privacy Policy (POL-PRV-001 §7). This policy is the internal operating procedure that backs that promise. The auditor reads this policy; the customer reads the Privacy Policy; the data subject who actually makes a request reads the intake page at `https://solarpro.app/privacy/requests` (forthcoming) and interacts with the `privacy@solarpro.app` mailbox.

The 3-person team constraint is real: this process is built so that a single person (Raymond or James) can fulfill any request, with a backup (the other one) and a documented audit trail. There is no 24/7 on-call rotation for data-subject requests; the SLA is calendar days, not business hours.

## 2. The rights

This policy covers the seven data-subject rights below. The mapping to the underlying legal basis is the right column; the fulfillment process is §3.

| Right | GDPR article | CCPA section | What it means in practice |
|---|---|---|---|
| **Right to access** | Art. 15 | § 1798.110 | The data subject receives a copy of the personal information we hold about them, in a commonly used electronic format. |
| **Right to rectification** | Art. 16 | § 1798.106 | Inaccurate personal information is corrected. Incomplete personal information is completed where appropriate. |
| **Right to erasure** ("right to be forgotten") | Art. 17 | § 1798.105 | Personal information is deleted, subject to the exceptions in Art. 17(3) (legal obligation, public interest, legal claims) and CCPA's enumerated exceptions. |
| **Right to restrict processing** | Art. 18 | n/a (closest is § 1798.121 right to limit use of sensitive PI) | The data subject's personal information is held but not actively processed while a dispute is resolved. |
| **Right to data portability** | Art. 20 | n/a (CCPA portability is implicit in the right to know) | The data subject receives their personal information in a structured, commonly used, machine-readable format (JSON) so they can move it to another service. |
| **Right to object** | Art. 21 | n/a (CCPA opt-out of "sale" is the closest) | The data subject can object to processing based on legitimate interest (GDPR Art. 6(1)(f)) or for direct marketing purposes. |
| **Right to withdraw consent** | Art. 7(3) | n/a (CCPA opt-out) | The data subject can withdraw any consent previously given (e.g. for product-update email). Withdrawal is as easy as the original consent was to give. |

**One additional right** is operational and not based on a single article:

| Right | Source | What it means in practice |
|---|---|---|
| **Right to lodge a complaint with a supervisory authority** | GDPR Art. 77; CCPA implicit | The data subject can complain to their local data protection authority (EU) or the California Attorney General (CCPA). We do not retaliate, do not refuse service, and do not charge a different price. |

The data subject can exercise any of these rights free of charge. The GDPR allows a "reasonable fee" for manifestly unfounded or excessive requests, but the operational rule at Solarpro is **no fee, ever, for a first request**. A repeated request from the same data subject for the same information within a 12-month window may be charged a reasonable fee or refused, per Art. 12(5); we have not yet needed to invoke this.

## 3. The process

Every data-subject rights request follows the same five-step process. The steps are designed for a 3-person team: each step has a primary owner, a backup, and an SLA. The process is the **ISO 27701 6.10.1** evidence.

### 3.1 Step 1 — Intake (target: same business day)

Every data-subject rights request enters through a single channel: **`privacy@solarpro.app`**. The mailbox is monitored by Raymond (primary) and James (backup). The mailbox forwards to both so either can pick up a new request.

The intake step includes:

- **Receipt acknowledged** within 1 business day. The acknowledgement is an email reply that says: "We received your request on [date]. We will respond within 30 days. If we need anything from you to verify your identity, we will ask. Your request reference is [DSR-YYYY-NNN]."
- **Request classified** into one of the seven rights in §2, with sub-classification for the data scope (account data only, account + projects, projects only, homeowner data, etc.).
- **Logged** in the data-subject request register at `compliance/privacy/dsr-register-<year>.csv` with the request ID, the date received, the requester, the right exercised, the data scope, the status, the assigned owner, the verification status, the fulfillment date, and the resolution.
- **Acknowledgement email** sent to the requester within 5 business days. The acknowledgement includes the request ID, the assigned owner, and the anticipated fulfillment date.

The intake SLA is "same business day for acknowledgement, 5 business days for the full acknowledgement email." Both are well inside the 30-day response SLA.

### 3.2 Step 2 — Identity verification (target: 5 business days)

Before any data is disclosed, corrected, deleted, exported, restricted, or objected to, the requester's identity is verified. The verification prevents an attacker from using a data-subject rights request as a way to enumerate or extract another person's data.

**For Solarpro account holders:**

- The requester is asked to confirm the email address on the account.
- If the request comes from the email address on file, no further verification is required.
- If the request comes from a different email address, the requester is asked to provide a one-time code sent to the email on file, or to upload a government-issued photo ID (handled per the Data Classification & Handling Policy §2.4 — ID is processed for verification only and then deleted within 30 days).

**For homeowners whose property appears in a survey:**

- The homeowner must provide a way for us to confirm their connection to the property. Acceptable evidence: a utility bill showing the address, a property-tax record, a mortgage statement. The evidence is processed for verification only and deleted within 30 days.
- If the homeowner is asking about a survey conducted by a Solarpro customer (a solar installer), we may ask the installer to confirm the homeowner's connection to the property as a faster alternative to the documentary check. The installer's confirmation is logged in the request register.

**For all other requesters (e.g. someone whose email appears in a survey note):**

- The requester is asked to confirm the specific data element they want to act on (e.g. "the email address jane.doe@example.com in survey #1234") and to provide one piece of supporting evidence.
- The supporting evidence is deleted within 30 days of request closure.

The verification SLA is 5 business days. If the verification cannot be completed within that window (e.g. the requester is slow to provide evidence), the requester is notified and the 30-day clock pauses. The pause is logged in the request register.

### 3.3 Step 3 — Fulfillment (target: within 30 days, target internal: 10 business days)

Once verified, the request is fulfilled by Raymond (primary) or James (backup). The fulfillment step depends on the right exercised.

#### 3.3.1 Access

- **Data sources queried**: the production database (`neon`), the audit log (`auditLog.ts`), the evidence store (the git repo + the Sentry project), the Sentry error logs (PII-scrubbed), the support email history (Google Workspace), and any subprocessor that may hold a copy (queried via the subprocessor's support channel).
- **Data assembled** into a JSON export. The export has the structure documented in `compliance/privacy/export-schema.md` (forthcoming) and includes:
  - **Account**: the requester's account record, organization membership, role history, login history (timestamps, IP, user agent), MFA enrollment status.
  - **Projects**: every project owned by or shared with the requester, with the project metadata, the survey data, the plan-set references, the BOM references, and the document references.
  - **Surveys**: every survey the requester created or was a named participant in, with the survey metadata, the roof/site data, the photos, the inspector notes, the utility data, and the GPS coordinates.
  - **Documents**: every document the requester created or uploaded (plan-sets, contracts, proposals, photos).
  - **Billing**: every invoice, payment, and subscription change.
  - **Support**: every support email to or from the requester.
  - **Audit log**: every audit-log entry involving the requester (the entries themselves, not the surrounding events).
  - **Third-party**: every known subprocessor that holds a copy of the requester's data, with the data scope and the deletion-confirmation path.
- **Export delivered** via a signed download link, valid for 7 days. The link is sent to the requester's verified email address. The link is generated using Vercel's signed-URL primitive (or an equivalent), is single-use, and logs the download in the request register.
- **SLA**: 10 business days for typical accounts; 30 days for accounts with a large document history (the 30-day cap is the GDPR Art. 12(3) extension, used sparingly).

#### 3.3.2 Rectification

- **Data sources**: the production database.
- **Data corrected** based on the requester's evidence. The correction is logged in the request register with the field, the old value (truncated for security), the new value, and the date.
- **Downstream systems**: if the corrected data was shared with a subprocessor, the subprocessor is notified and asked to apply the same correction within 30 days. The notification is tracked in the request register.
- **SLA**: 5 business days for the correction in the production database; up to 30 days for the downstream propagation.

#### 3.3.3 Erasure

- **Data sources**: the production database (Neon), the audit log (the entries are retained per the audit log retention schedule, but the requester's identifying fields are pseudonymized), the evidence store, Sentry (the requester's events are deleted via the Sentry API), the support email history (the requester's emails are deleted; the surrounding thread is retained with the requester's identifying fields redacted).
- **Data deleted** by:
  - Database rows: hard delete (or `UPDATE ... SET deleted_at = NOW()` for soft-delete-required tables; the soft-delete is followed by a hard delete after 30 days).
  - Photos: hard delete from the object store.
  - Logs: the requester's identifying fields are replaced with a stable pseudonym (`deleted-user-<request-id>`); the surrounding log entries are retained.
  - Backups: the data is deleted from the production database immediately; the backups (Neon PITR, 7-day window) are not selectively deleted, but the data ages out of the backup window within 7 days. The customer-facing confirmation says "your data is deleted from production immediately and from backups within 7 days."
  - Subprocessors: every subprocessor that holds a copy is notified and asked to confirm deletion within 30 days. The notification is tracked in the request register.
- **Exceptions** (when erasure is NOT performed):
  - The data is necessary for compliance with a legal obligation (tax records, anti-money-laundering records, permit records — typically 7-year retention).
  - The data is necessary for the establishment, exercise, or defence of legal claims.
  - The data is necessary for the performance of a contract the data subject is a party to (e.g. an in-flight service the data subject is paying for).
  - The data is anonymized aggregate data that is no longer personal information.
  - The data subject's request is manifestly unfounded or excessive.
  - In each case, the exception is logged with the legal basis and the specific reasoning. The data subject is informed.
- **SLA**: 15 business days for production deletion; up to 30 days for subprocessor confirmation.

#### 3.3.4 Restriction of processing

- **Data sources**: the production database.
- **Implementation**: the requester's account is flagged as "restricted" in the production database. The application logic checks the flag before any read or write operation. Restricted accounts cannot be logged into, cannot receive email, and cannot be processed for any purpose other than storage.
- **Communication**: the requester is informed that the restriction is in place and that the restriction will be lifted when the dispute is resolved (or the data is deleted, or the restriction period expires).
- **SLA**: 5 business days for the flag to be in place; lifted within 5 business days of resolution.

#### 3.3.5 Data portability

- **Data sources**: same as the access request (§3.3.1).
- **Format**: JSON, structured per the export schema. The JSON is a self-contained file with no proprietary extensions.
- **Delivery**: signed download link, 7-day validity, same as the access request.
- **SLA**: 10 business days; up to 30 days for large accounts.

#### 3.3.6 Objection

- **Data sources**: depends on the specific processing objected to.
- **Implementation**: the objection is reviewed by Raymond within 5 business days. The review determines whether the objection has merit (the processing is no longer necessary, the data subject's situation overrides the legitimate interest, the processing is for direct marketing — which we do not do, so this is a no-op). If the objection has merit, the processing is stopped. If the objection does not have merit, the data subject is informed with the reasoning.
- **SLA**: 5 business days for the initial review; up to 30 days for the full assessment.

#### 3.3.7 Withdrawal of consent

- **Data sources**: the marketing / consent database (the `email_preferences` table in the production database; the consent is also stored in the customer's Stripe customer record for billing-related consents).
- **Implementation**: the consent flag is set to `false` in the database. The next email send to the data subject will skip them. For product-update email, the unsubscribe is also processed by Resend (the email service provider) to ensure no further emails are sent.
- **SLA**: immediate (within 1 business day) for the consent flag; up to 5 business days for the confirmation to the data subject.

### 3.4 Step 4 — Confirmation and audit log (target: same day as fulfillment)

Every fulfilled request produces a confirmation to the data subject and a row in the request register. The confirmation includes:

- The request ID.
- The right exercised.
- The data scope (a brief description of what was accessed, corrected, deleted, exported, restricted, objected to, or had consent withdrawn).
- The date of fulfillment.
- Any subprocessor notifications sent.
- The next steps (if any) — e.g. "your subprocessor deletions will be confirmed within 30 days; we will email you when complete."

The audit log entry includes the same fields, plus:

- The verification method used (the type, not the underlying data — we don't store the ID document).
- The requester's identity-verification status.
- The fulfillment actions taken.
- The exception claimed (if any), with the legal basis.

The audit log is the **ISO 27701 6.10.1 / GDPR Art. 30** evidence: that Solarpro maintains a record of every data-subject rights request and the action taken.

### 3.5 Step 5 — Closure and retention

The request is closed when:

- The fulfillment is complete.
- The subprocessor confirmations (where applicable) are received or the 30-day subprocessor-confirmation window has elapsed.
- The data subject has confirmed (or 14 days have passed since the fulfillment confirmation without a dispute).

Closed requests are retained in the request register for **7 years** (matching the audit log retention in the Data Classification & Handling Policy §6.1 and the SOC 2 audit log retention). The retention is required for compliance with the GDPR accountability principle (Art. 5(2)) and for the SOC 2 audit.

## 4. SLAs and escalation

### 4.1 SLAs

| Step | SLA | Notes |
|---|---|---|
| **Receipt acknowledgement** | Same business day | Auto-reply if the mailbox is unattended. |
| **Full acknowledgement email** | 5 business days | Includes the request ID and the assigned owner. |
| **Identity verification** | 5 business days | Pauses the 30-day clock if evidence is slow to arrive. |
| **Access fulfillment** | 10 business days (typical) / 30 days (large accounts) | The 30-day cap is the GDPR Art. 12(3) extension. |
| **Rectification** | 5 business days (DB) / 30 days (downstream) | Two-step SLA. |
| **Erasure** | 15 business days (production) / 30 days (subprocessor) | Two-step SLA. |
| **Restriction** | 5 business days (in place) / 5 business days (lift) | |
| **Portability** | 10 business days (typical) / 30 days (large) | |
| **Objection** | 5 business days (initial review) / 30 days (full assessment) | |
| **Consent withdrawal** | 1 business day (flag) / 5 business days (confirmation) | |
| **Audit log entry** | Same day as fulfillment | |
| **Closure** | 14 days after fulfillment (or data-subject confirmation) | |

The default response SLA across all rights is **30 calendar days from receipt**, per GDPR Art. 12(3). The 30-day clock starts on the day of receipt and stops only for the time the data subject takes to respond to a verification request. The clock is documented in the request register.

For California consumers, the response SLA is **45 calendar days** under CCPA § 1798.130(a)(2), with a 45-day extension on written notice. The 30-day GDPR SLA is shorter than the 45-day CCPA SLA, so the GDPR SLA covers both — the operational rule is "30 days unless a longer CCPA SLA is explicitly required."

### 4.2 Escalation

If a request cannot be fulfilled within the SLA, the requester is informed with:

- The reason for the delay.
- The new anticipated fulfillment date.
- The right to lodge a complaint with a supervisory authority.

The escalation is owned by Raymond (primary) or James (backup). If neither can fulfill within the SLA, James is the final escalation; the request is paused, the requester is informed, and a `compliance-exception` Linear issue is opened with a 14-day maximum duration.

### 4.3 Refusal

A request can be refused only when:

- The data subject's identity cannot be verified (after at least one re-attempt).
- The request is manifestly unfounded or excessive (e.g. a request to access the data of every Solarpro user, framed as 50,000 separate requests).
- The data is subject to a legal hold (litigation, regulatory investigation).
- A specific exception in §3.3.3 (erasure) or §3.3.6 (objection) applies.

Every refusal is logged with the reason and the legal basis, and the data subject is informed. The data subject retains the right to lodge a complaint with a supervisory authority.

## 5. Operational details

### 5.1 The request register

The request register is at `compliance/privacy/dsr-register-<year>.csv` (one file per year, append-only). The schema:

| Column | Type | Description |
|---|---|---|
| `request_id` | string | `DSR-YYYY-NNN` |
| `received_at` | ISO 8601 | When the request was received (the 30-day clock starts here). |
| `requester_name` | string | The data subject's name. |
| `requester_email` | string | The verified email address. |
| `right_exercised` | enum | `access`, `rectification`, `erasure`, `restriction`, `portability`, `objection`, `consent-withdrawal`, `complaint` |
| `data_scope` | string | Brief description of the data affected. |
| `verification_method` | enum | `email-match`, `otp-on-file`, `government-id`, `property-evidence`, `installer-confirmation`, `other` |
| `assigned_owner` | string | `Raymond` or `James` |
| `status` | enum | `received`, `verifying`, `verified`, `in-fulfillment`, `fulfilled`, `awaiting-subprocessors`, `closed`, `refused` |
| `fulfillment_date` | ISO 8601 | When the fulfillment is complete. |
| `closure_date` | ISO 8601 | When the request is closed. |
| `exception_claimed` | string | The legal basis for any refusal or partial fulfillment. |
| `notes` | string | Anything else worth recording. |

The register is the **GDPR Art. 30 (Records of processing activities)** evidence for the data-subject rights process.

### 5.2 The intake page

A public intake page at `https://solarpro.app/privacy/requests` (forthcoming) is the self-service front door. The page:

- Explains the seven rights in plain English.
- Has a form that creates the request and sends it to `privacy@solarpro.app`.
- Provides a download link for the export (when the request is for access or portability).
- Provides a status tracker keyed off the request ID.

The intake page is a future enhancement; until it ships, the email-only path is the operative channel.

### 5.3 The audit-log entry

Every action taken on a data-subject rights request is logged in `auditLog.ts` (the production audit log). The log entry includes:

- The actor (Raymond or James).
- The request ID.
- The action (e.g. `dsr.access.export.generated`, `dsr.erasure.database.deleted`, `dsr.rectification.field.updated`).
- The data scope.
- The timestamp.

The audit log is the **SOC 2 CC6.1 + ISO 27001 A.5.28** evidence that data-subject rights actions are tracked and reviewable.

## 6. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Primary owner of every data-subject rights request. Reviews the request register monthly. Approves refusals. |
| **Management sign-off** | **James Carpenter** | Backup owner. Final escalation. Approves any refusal involving a customer relationship. |
| **Technical lead** | **Cody** | Builds the export tooling, the intake page, and the audit-log integration. Does not see the request contents (the data is encrypted at rest and the export tooling delivers the export, not Cody). |

## 7. Exceptions

Exceptions to the SLAs in this policy follow the standard exception process in the Information Security Policy (POL-IS-001 §8):

1. **Documented** in a Linear issue tagged `compliance-exception` and `dsr-exception`.
2. **Approved by Raymond** with a stated duration (max 14 days without re-approval for SLA extensions; max 90 days for other deviations).
3. **Disclosed to James** if the exception involves a P0 control, a customer relationship, or a regulator inquiry.

## 8. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/04-data-classification-handling.md` — what data is PII, what the data classes are.
- `compliance/policies/05-incident-response.md` — when a data-subject rights request is part of an incident (e.g. a breach notification triggers multiple erasure requests).
- `compliance/policies/10-vendor-risk-management.md` — the subprocessor relationships that this policy relies on for subprocessor deletion confirmations.
- `compliance/policies/18-privacy-policy.md` (POL-PRV-001) — the customer-facing policy that references this one.
- `compliance/policies/20-data-retention-disposal.md` (POL-PRV-003) — the retention schedule; the erasure SLA in this policy is shorter than the retention schedule, so erasure takes precedence.
- `compliance/CONTROL_MATRIX.md` — ISO 27701 6.10 / 6.11 / 6.12, SOC 2 P-series, GDPR Chapter III, CCPA § 1798.100-130 current state and evidence.
- `compliance/privacy/dsr-register-<year>.csv` — the request register.
- `compliance/privacy/export-schema.md` — forthcoming export schema.
- `https://solarpro.app/privacy/requests` — forthcoming intake page.
- `auditLog.ts` — the production audit log that records every data-subject rights action.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Operationalizes the seven GDPR Articles 15-22 rights (plus the CCPA equivalents and the supervisory-authority complaint right) as a five-step process: intake → verification → fulfillment → confirmation + audit log → closure. Sets a 30-day default response SLA (GDPR Art. 12(3) standard) with 45-day CCPA fallback; tiered internal SLAs (1-5 days for acknowledgements and verifications, 5-15 days for typical fulfillments, up to 30 days for large accounts or downstream propagation). Defines the verification methods (email-match for account holders, property evidence for homeowners, documentary evidence for others), the export schema for access and portability, the erasure method (hard delete + subprocessor notification + 7-day PITR backup window), the restriction mechanism (a production flag in the database), the refusal grounds, the request register schema, and the audit-log integration. Calls out the future-state work: the public intake page at `/privacy/requests` and the export schema doc. |
