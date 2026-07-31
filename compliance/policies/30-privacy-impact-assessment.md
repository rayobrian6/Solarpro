# Privacy Impact Assessment Policy

| Field | Value |
|---|---|
| **Policy** | POL-PRV-004 — Privacy Impact Assessment (PIA) Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual), or on material change (new PII type, new processing purpose, new sub-processor, new framework in scope) |
| **Scope** | Every new processing activity involving PII; every change to an existing PII processing activity; every new vendor handling PII; every new PII data subject category; every new PII storage location; every new PII retention period; every new PII security control. Out of scope: changes that do not affect PII (e.g. a UI redesign, a non-PII feature) — those are governed by the Change Management Policy (#06) only. |

---

## 1. Purpose

This policy is the rule for **how Solarpro assesses the privacy impact of a new or changed processing activity**. It is the **ISO 27001 A.5.34 + ISO 27701 6.4 / 6.5 / 6.6 + SOC 2 P-series** evidence: that Solarpro has a defined PIA process, a PIA template, a PIA trigger, a PIA approval workflow, a PIA record retention, and a PIA register.

The Privacy Policy (#18) is the **customer-facing** privacy notice — the document the customer reads at `https://solarpro.app/privacy`. The Data Subject Rights Policy (#19) is the **operational** process for handling access / rectification / erasure / portability requests. The Data Retention & Disposal Policy (#20) is the **retention schedule**. This policy is the **PIA process** — the assessment that runs before a new processing activity starts.

The 2026-07-30 control matrix row 6.4.x (PII minimization, accuracy, storage limitation) was Partial; the 6.5.x (PII sharing, transfer, disclosure) was Gap; the 6.6.x (PII breach notification) was Not assessed. The §3 of this policy defines the PIA trigger conditions that cover the gaps.

Solarpro is a **PII controller** for homeowner/inspector data (survey intake) and a **PII processor** for utility/AHJ data (resolving on behalf of customers). The PIA process is the operational rule for both roles.

The policy includes a **sample retroactive PIA** for the existing processing (so an auditor sees the policy operating, not just aspirational). The retroactive PIA is at `compliance/privacy/pia-retroactive-2026-08-15.md`; the PIA template is at `compliance/privacy/pia-template.md`. Both files are the §3 PIA process operating; both are the §10 record retention evidence.

## 2. The PIA trigger conditions

A PIA is required when **any** of the §2.1–§2.6 conditions is met. A condition is met when the change is **material** (per the §2.7 materiality test).

### 2.1 New PII collection

A PIA is required when Solarpro starts collecting a **new PII field** that was not previously collected. Examples:

- Adding a new field to the survey schema (e.g. a "property type" field that is not currently collected).
- Adding a new tracking pixel or analytics tool that collects user-level data.
- Adding a new third-party widget that collects PII (e.g. a chat widget that logs the user's email).

The PIA assesses the necessity, the proportionality, the data subject's reasonable expectation, the retention period, the security controls, and the data subject rights process.

### 2.2 New PII processing purpose

A PIA is required when Solarpro starts using **existing PII for a new purpose**. Examples:

- Using the customer email for marketing when the original purpose was transactional.
- Using the survey PII for ML training when the original purpose was planset generation.
- Using the homeowner address for a new product feature (e.g. a roof inspection scheduling tool).

The PIA assesses the legal basis for the new purpose (the §3.4 legal basis is required for every processing purpose), the data subject's reasonable expectation, the opt-out / opt-in mechanism, and the data subject rights process.

### 2.3 New PII sharing with a third party

A PIA is required when Solarpro starts sharing PII with a **new third party** (a new sub-processor). Examples:

- Adding a new vision API vendor (a second OpenAI / Anthropic / Google Solar / similar).
- Adding a new payment processor (a second Stripe / Adyen / similar).
- Adding a new email vendor (a second Resend / SendGrid / similar).
- Adding a new analytics vendor (a new Mixpanel / Amplitude / similar).

The PIA assesses the new vendor's security posture (the §4 vendor review per Policy #10), the DPA (per Policy #16), the data transfer mechanism (per §5 cross-border transfer), the data subject's reasonable expectation, and the §6 PII redaction.

### 2.4 New PII storage location

A PIA is required when Solarpro starts storing PII in a **new location**. Examples:

- Adding a new cloud region (e.g. moving the Neon database from us-east-1 to eu-west-1).
- Adding a new on-prem storage (Solarpro is cloud-only today; if the posture changed, a PIA is required).
- Adding a new backup location (e.g. a new R2 bucket in a new region).

The PIA assesses the data residency (per §5 cross-border transfer), the data subject's reasonable expectation, the security controls at the new location, the §7 audit + monitoring, and the §8 breach notification (if the breach is in the new location).

### 2.5 New PII retention period

A PIA is required when Solarpro changes the **retention period** for an existing PII category. Examples:

- Extending the survey PII retention from 7 years to 10 years.
- Shortening the customer account PII retention from 2 years post-closure to 6 months.
- Changing the marketing PII retention (e.g. the "unsubscribe" timer).

The PIA assesses the necessity of the new retention period, the legal basis, the data subject's reasonable expectation, the impact on the data subject rights process (e.g. the §3 erasure), and the §5 disposal.

### 2.6 New PII security control

A PIA is required when Solarpro implements a **new security control** that affects PII. Examples:

- Adding a new encryption layer (e.g. an application-level encryption on top of the storage-layer encryption).
- Adding a new access control (e.g. a new MFA requirement for PII access).
- Adding a new monitoring control (e.g. a new Sentry alert for PII access).
- Removing an existing security control (a PIA is required for a removal because the removal may increase the PII risk).

The PIA assesses the effectiveness of the new control, the residual risk, the impact on the data subject rights process, the impact on the §7 audit + monitoring, and the §8 breach notification (if the new control affects the breach detection time).

### 2.7 The materiality test

A change is **material** when **any** of the §2.7.1–§2.7.4 criteria is met. A change that is not material does not require a PIA; the change is governed by the Change Management Policy (#06) only.

#### 2.7.1 The PII sensitivity test

A change is material if the new PII is **more sensitive** than the existing PII. Sensitivity is per the Data Classification & Handling Policy (#04) §3.2:

- **Public** → no PIA required.
- **Internal** → no PIA required.
- **Confidential** → PIA required.
- **Restricted** → PIA required.

A new PII field classified as Confidential or Restricted triggers a PIA.

#### 2.7.2 The data subject volume test

A change is material if the new processing affects **more than 100 data subjects** in the first 12 months. The 100-data-subject threshold is the §2.7.2 default; a change that affects fewer than 100 data subjects may still be material per the §2.7.1 sensitivity test or the §2.7.3 cross-border test.

#### 2.7.3 The cross-border transfer test

A change is material if the new processing involves a **cross-border transfer** of PII (e.g. EU → US). The cross-border transfer is per the §5 below; any cross-border transfer triggers a PIA.

#### 2.7.4 The high-risk processing test

A change is material if the new processing is a **high-risk processing activity** per the GDPR Art. 35 examples:

- Systematic and extensive evaluation of personal aspects (e.g. profiling) on which decisions are based that produce legal effects.
- Processing of special-category data on a large scale.
- Systematic monitoring of a publicly accessible area on a large scale.

Solarpro does not currently engage in any of these activities; the §2.7.4 test is the forward-looking rule.

## 3. The PIA process

The PIA process is the **5-step structured assessment**. The process is the §3.1–§3.5 steps; the PIA template is at `compliance/privacy/pia-template.md`.

### 3.1 Step 1 — Identify the processing

The first step is to **identify the processing**. The identification includes:

- **What PII is involved** (the fields, the categories, the data subjects).
- **Why the PII is needed** (the processing purpose).
- **Who is involved** (the data subjects, the internal handlers, the third parties).
- **When the processing happens** (the trigger, the frequency, the duration).
- **Where the processing happens** (the system, the location, the jurisdiction).
- **How the processing happens** (the security controls, the data flows).

The identification is the **factual basis** for the PIA. The auditor reads the identification to verify the PIA is grounded in the actual processing, not a copy-paste from a template.

### 3.2 Step 2 — Describe the processing

The second step is to **describe the processing**. The description includes:

- **Purpose** — the specific processing purpose (e.g. "to generate a planset for the homeowner's roof"; NOT "to improve our service").
- **Data subjects** — the categories of data subjects (e.g. "homeowners in the US who have requested a planset"; NOT "users").
- **Data types** — the PII fields (e.g. "name, address, email, phone, roof photos, roof conditions"; NOT "user data").
- **Retention** — the retention period (e.g. "7 years from project completion per the permit records retention"; NOT "as long as needed").
- **Sharing** — the third parties (e.g. "OpenAI for vision API processing of the roof photos"; NOT "our service providers").
- **Security controls** — the controls protecting the PII (e.g. "TLS in transit, AES-256 at rest, application-level redaction before vision API transit"; NOT "industry-standard security").

The description is the **detailed factual basis** for the PIA. The auditor reads the description to verify the PIA is concrete + specific + grounded in the actual processing.

### 3.3 Step 3 — Assess necessity and proportionality

The third step is to **assess the necessity and proportionality**. The assessment includes:

- **Necessity** — is the PII needed for the purpose? Could the purpose be achieved with less PII? Could the purpose be achieved with anonymized or aggregated data?
- **Proportionality** — is the PII collection proportionate to the purpose? Is the retention period proportionate? Is the sharing proportionate?
- **Less-intrusive alternatives** — what less-intrusive alternatives were considered? Why were they rejected?
- **Data minimization** — what fields are required? What fields are optional? What fields are collected "just in case"?

The assessment is the **GDPR Art. 5(1)(c) (Data minimization) + Art. 5(1)(b) (Purpose limitation) + Art. 6 (Lawfulness)** evidence. The auditor reads the assessment to verify the processing is necessary + proportionate.

### 3.4 Step 4 — Identify risks to data subjects

The fourth step is to **identify the risks to data subjects**. The risks are the §3.4.1–§3.4.5 categories.

#### 3.4.1 Unauthorized access

The risk that an unauthorized party accesses the PII. The risk is mitigated by the §6 access control + the §7 audit + monitoring.

#### 3.4.2 Unauthorized disclosure

The risk that the PII is disclosed to a party that should not have it. The risk is mitigated by the §6 PII redaction + the §8 breach notification.

#### 3.4.3 Unauthorized modification

The risk that the PII is modified by an unauthorized party. The risk is mitigated by the §6 access control + the §7 audit + monitoring.

#### 3.4.4 Unauthorized destruction

The risk that the PII is destroyed by an unauthorized party or by a process error. The risk is mitigated by the §7 backup + the §8 disposal.

#### 3.4.5 Unintended secondary use

The risk that the PII is used for a purpose other than the original purpose. The risk is mitigated by the §2.2 new-purpose PIA trigger + the §3.3 purpose-limitation assessment.

### 3.5 Step 5 — Determine mitigations

The fifth step is to **determine the mitigations**. The mitigations are the §6.1–§6.5 controls. The mitigations reduce the §3.4 risks to an acceptable level.

The mitigations are the **operational implementation** of the PIA. The auditor reads the mitigations to verify the risks are addressed.

## 4. PIA approval

The PIA is approved by **Raymond (CISO) for security risks** + **James (CEO) for commercial risks**. The approval is per the §4.1 sign-off + the §4.2 conditional approval.

### 4.1 Sign-off

The PIA sign-off is the **§4.1.1 security sign-off + the §4.1.2 commercial sign-off**.

#### 4.1.1 Security sign-off

Raymond (CISO) signs off on:

- The §3.4 risk identification (the risks are real + material).
- The §3.5 mitigation identification (the mitigations are sufficient).
- The §6 access control (the access is least-privilege).
- The §7 audit + monitoring (the monitoring is operating).
- The §8 breach notification (the notification is feasible).

The security sign-off is the §4.1.1 evidence; the auditor reads the sign-off to verify the security review is operating.

#### 4.1.2 Commercial sign-off

James (CEO) signs off on:

- The §3.1 purpose identification (the purpose is a real business purpose).
- The §3.3 necessity + proportionality (the necessity is real + the proportionality is balanced).
- The §2.1–§2.6 trigger conditions (the trigger is met).
- The §5 cross-border transfer (the transfer mechanism is documented).
- The data subject rights (the §3.2 description is accurate + the §3.5 mitigations are feasible).

The commercial sign-off is the §4.1.2 evidence; the auditor reads the sign-off to verify the commercial review is operating.

### 4.2 Conditional approval

A PIA may be **conditionally approved** when:

- The §3.4 risks are Low or Medium + the §3.5 mitigations are documented + a target date is set.
- The §3.4 risks are High + the §3.5 mitigations are documented + a target date is set + a follow-up PIA is scheduled.
- The §3.4 risks are Critical + the PIA is **rejected** (the processing does not start until the risks are Mitigated to Medium or lower).

A conditional approval is recorded in the PIA's `notes` column; the follow-up PIA is scheduled in the §8 PIA register.

## 5. Cross-border transfers

A PII transfer to a **different jurisdiction** is a §2.7.3 cross-border transfer. The cross-border transfer requires:

1. **A documented transfer mechanism** — the Standard Contractual Clauses (SCCs) for EU → US; the UK International Data Transfer Agreement (IDTA) for UK → US; the APEC Cross-Border Privacy Rules (CBPR) for APEC; the Swiss-US Data Privacy Framework for Swiss → US.
2. **A transfer impact assessment** — the assessment of the receiving country's surveillance laws + the data subject's reasonable expectation + the receiving party's security posture.
3. **A data subject notification** — the customer-facing Privacy Policy (§6) discloses the transfer + the mechanism.

The cross-border transfer is the **GDPR Chapter V (Transfers of personal data to third countries or international organizations) + the UK GDPR + the Swiss FADP + the APEC CBPR** evidence.

The current state (as of 2026-08-15):

- **EU → US**: SCCs in the vendor DPAs (per Policy #16 §5). The §5 transfer impact assessment is per the vendor SOC 2 report.
- **UK → US**: IDTA in the vendor DPAs (per Policy #16 §5).
- **APEC**: CBPR membership is not yet in place; the PIA process is the interim mechanism.
- **Swiss → US**: Swiss-US Data Privacy Framework is not yet in place; the SCCs are the interim mechanism.

The cross-border transfer is a §2.7.3 PIA trigger; a PIA is required for every new cross-border transfer.

## 6. PIA mitigations

The §3.5 mitigations are the **operational controls** that reduce the §3.4 risks. The mitigations are the §6.1–§6.5 categories.

### 6.1 Access control

The PII is accessed only by **authorized parties**. The access control is per Policy #03 + the §3.2 of Policy #26 (the per-environment access). The PIA documents the specific access list (the named roles + the named individuals + the named vendors).

### 6.2 PII redaction

The PII is **redacted** before transit to third parties + before storage in non-production environments. The redaction is per the §4.3 of Policy #26 (the development database anonymization) + the §3.2 of Policy #08 (the Sentry redaction). The PIA documents the specific redaction (the fields redacted + the method + the verification).

### 6.3 Encryption

The PII is **encrypted** in transit + at rest. The encryption is per Policy #21. The PIA documents the specific encryption (the TLS version + the at-rest encryption + the key management).

### 6.4 Audit + monitoring

The PII access is **logged + monitored**. The audit + monitoring is per Policy #08. The PIA documents the specific audit + monitoring (the log fields + the alerts + the retention).

### 6.5 Breach notification

A PII breach is **detected + contained + notified** within the §8 of Policy #05. The PIA documents the specific breach notification (the detection mechanism + the containment procedure + the notification timeline).

## 7. PIA register

The PIA register is the **single source of truth** for every PIA. The register is at `compliance/privacy/pia-register.csv`; the register is the §7 schema.

### 7.1 The register schema

The CSV columns:

| Column | Type | Description |
|---|---|---|
| `pia_id` | string | Unique PIA identifier; format `PIA-<YYYY>-<NNN>` (e.g. `PIA-2026-001`). |
| `title` | string | Short PIA title. |
| `trigger` | enum | One of: `new_pii_collection`, `new_purpose`, `new_sharing`, `new_location`, `new_retention`, `new_security_control`. |
| `trigger_description` | string | The specific trigger (e.g. "Added 'property_type' field to survey schema"). |
| `effective_date` | date | The date the processing starts (or changed). |
| `owner` | string | The PIA owner; one of: James, Raymond, Cody. |
| `security_signoff` | date | The date Raymond signed off. |
| `commercial_signoff` | date | The date James signed off. |
| `status` | enum | One of: `draft`, `in_review`, `approved`, `conditionally_approved`, `rejected`, `closed`. |
| `risks_identified` | integer | The number of risks identified in the PIA. |
| `mitigations_implemented` | integer | The number of mitigations implemented. |
| `follow_up_pia` | string | The follow-up PIA ID (if conditionally approved). |
| `evidence_reference` | string | The path to the PIA document. |
| `notes` | string | Free-form notes. |

### 7.2 The seed rows

The seed row is the **retroactive PIA for the existing processing** (the §10.1 sample). The retroactive PIA is at `compliance/privacy/pia-retroactive-2026-08-15.md`; the PIA is filed under `PIA-2026-001`. The retroactive PIA is the §10.1 evidence that the policy is operating (not just aspirational).

The second seed row will be the **PIA for the new PII redaction before transit to third-party vision APIs** (the §4.7 of Policy #18 + the §3 of Policy #30 + the 2026-07-30 control matrix ISO 27701 6.5.x P0). The PIA will be filed when the redaction is implemented; the target date is 2026-09-30.

## 8. PIA record retention

The PIA records are retained for **7 years** from the effective date of the processing (or from the date the processing ends, if it ends). The 7-year retention is per:

- **GDPR Art. 5(1)(e)** (storage limitation) — the PII is not kept longer than necessary.
- **SOC 2 CC6.5** (asset retirement) — the logical + physical protection is discontinued only when no longer required.
- **Audit + regulatory** — the 7-year retention covers the SOC 2 Type 2 observation period + the ISO 27001 cert cycle + the GDPR + the CCPA + the state breach notification laws.

The 7-year retention is the §8 rule; the auditor reads the retention evidence at the §7 register + the PIA documents.

## 9. PIA in the audit context

The PIA is the **SOC 2 P-series + the ISO 27701 6.4.x / 6.5.x / 6.6.x + the ISO 27001 A.5.34** evidence. The auditor reads:

1. The PIA process (this policy).
2. The PIA template (the §3.1–§3.5 structure).
3. The PIA register (the §7 register).
4. The PIA documents (the §10.1 retroactive PIA + the future PIAs).
5. The cross-border transfer mechanism (the §5 SCCs / IDTA).
6. The mitigations (the §6 controls).
7. The retention evidence (the §8 7-year retention).

The auditor samples the PIA documents to verify the §3 process is operating + the §4 approval is operating + the §6 mitigations are implemented.

## 10. The retroactive PIA

The retroactive PIA is the **PIA for the existing processing** (the processing that started before this policy was written). The retroactive PIA is the §10.1 sample + the §10.2 template.

### 10.1 The retroactive PIA sample

The retroactive PIA is at **`compliance/privacy/pia-retroactive-2026-08-15.md`**. The retroactive PIA documents the existing processing (the survey intake → planset generation → permit snapshot pipeline) and assesses the §3.4 risks + the §3.5 mitigations.

The retroactive PIA is the **SOC 2 P-series + the ISO 27701 6.4.x / 6.5.x / 6.6.x** evidence that the policy is operating for the existing processing. The auditor reads the retroactive PIA to verify the policy is not just aspirational.

### 10.2 The PIA template

The PIA template is at **`compliance/privacy/pia-template.md`**. The template is the §3.1–§3.5 structure pre-filled with placeholder text; the PIA owner fills in the placeholders + signs the PIA.

The template is the **standardization** of the PIA process. Every PIA uses the template; every PIA follows the §3.1–§3.5 structure. The template is the §4 approval workflow's input.

## 11. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the PIA for security risks. Signs off on the §4.1.1 security sign-off. Maintains the §7 PIA register. Reviews the §8 retention. Owns the §5 cross-border transfer assessment. |
| **Management sign-off** | **James Carpenter** | Reviews the PIA for commercial risks. Signs off on the §4.1.2 commercial sign-off. Approves the §5 cross-border transfer. Approves the §4.2 conditional approval. |
| **Technical lead** | **Cody** | Implements the §6 mitigations. Provides the §3.2 description input (the system + the security controls). Implements the §5 transfer mechanism. |
| **All team members** | James, Raymond, Cody | File a PIA request (Linear issue tagged `pia-request`) when they identify a §2 trigger condition. The request feeds the §3 PIA process. |

A PIA request that is not responded to within 5 business days is escalated to James + Raymond.

## 12. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §2 trigger conditions (new conditions may have emerged), a refresh of the §3 process (the GDPR / ISO 27701 guidance may have changed), a refresh of the §5 cross-border transfer (new jurisdictions may be in scope), and a refresh of the §7 register.
- **On material change** — within 30 days of any of: a new framework in scope (e.g. FIPS 140-3), a new PII type, a new processing purpose, a new sub-processor, a new cross-border transfer mechanism, a new retention period, a new security control.
- **After every PIA** — the PIA's findings may identify gaps in the §3 process; the gaps are incorporated.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 13. Related documents

- `compliance/policies/01-information-security.md` — the foundation; the §8 exception process.
- `compliance/policies/04-data-classification-handling.md` — the §2.7.1 PII sensitivity classification.
- `compliance/policies/08-logging-monitoring.md` — the §6.4 audit + monitoring.
- `compliance/policies/10-vendor-risk-management.md` — the §2.3 new sub-processor trigger.
- `compliance/policies/16-third-party-service-provider.md` — the §2.3 DPA + the §5 cross-border transfer.
- `compliance/policies/18-privacy-policy.md` — the customer-facing notice; the §5 data subject notification.
- `compliance/policies/19-data-subject-rights.md` — the §3.4.5 un-intended secondary use mitigation.
- `compliance/policies/20-data-retention-disposal.md` — the §2.5 new retention trigger; the §8 7-year retention.
- `compliance/policies/21-encryption-key-management.md` — the §6.3 encryption mitigation.
- `compliance/policies/26-virtual-environment-security.md` — the §6.2 PII redaction in non-production environments.
- `compliance/privacy/pia-template.md` — the PIA template (the §3.1–§3.5 structure).
- `compliance/privacy/pia-retroactive-2026-08-15.md` — the retroactive PIA sample (the §10.1 evidence).
- `compliance/privacy/pia-register.csv` — the §7 PIA register.
- `compliance/CONTROL_MATRIX.md` — the ISO 27701 6.4.x / 6.5.x / 6.6.x + the SOC 2 P-series + the ISO 27001 A.5.34 evidence rows.
- `compliance/vendors.csv` — the 12-vendor register; the §2.3 new sub-processor trigger.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the §2 PIA trigger conditions (new PII collection / new purpose / new sharing / new location / new retention / new security control + the §2.7 materiality test), the §3 5-step PIA process (identify / describe / assess / identify risks / determine mitigations), the §4 PIA approval workflow (Raymond = security sign-off; James = commercial sign-off; conditional approval for Medium / High; rejection for Critical), the §5 cross-border transfer (SCCs for EU → US; IDTA for UK → US; CBPR for APEC; Swiss-US DPF for Swiss → US), the §6 PIA mitigations (access control + PII redaction + encryption + audit + monitoring + breach notification), the §7 PIA register schema + the §7.2 seed rows (the retroactive PIA + the future redaction PIA), the §8 7-year record retention, the §9 PIA in the audit context, the §10 retroactive PIA sample + the PIA template, the §11 roles (Raymond = CISO owner; James = management sign-off; Cody = technical), and the §12 review cadence. Closes the ISO 27001 A.5.34 + ISO 27701 6.4.x / 6.5.x / 6.6.x + SOC 2 P-series control set. The retroactive PIA at `compliance/privacy/pia-retroactive-2026-08-15.md` is the §10.1 evidence that the policy is operating for the existing processing (not just aspirational). |
