# Shared Responsibility Matrix

| Field | Value |
|---|---|
| **Policy** | POL-IS-025 — Shared Responsibility Matrix |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new Tier 1 vendor, vendor scope change, new framework in scope) |
| **Scope** | Every cloud service in the Solarpro stack (Vercel, Neon, Render, Cloudflare, GitHub, GCP, OpenAI, Anthropic, Stripe, Resend, Sentry, Cloudflare R2) × every shared-responsibility control area (data, application, runtime, OS, network, physical, IAM, monitoring). The matrix is the per-vendor deep-dive that backs the narrative in the Cloud Services Security Policy (#24). |

---

## 1. Purpose

This policy is the **table version of the Cloud Services Security Policy (#24) §3**. Where Policy #24 is the narrative ("the vendor owns the physical security, the hypervisor, the network; Solarpro owns the data, the application, the IAM; the boundary is shared for encryption, incident response, and the application-layer configuration"), this policy is the **per-vendor deep-dive** that maps every shared-responsibility control area to every cloud service Solarpro depends on. It's the **SOC 2 CC6.6 + ISO 27017 A.5.23** evidence — and A.5.23 is the cloud-specific control that requires this exact artifact.

ISO 27017 A.5.23 (Information security for use of cloud services) explicitly requires the customer to document the division of responsibilities between the cloud service customer and the cloud service provider. The auditor will check for a per-service matrix; the matrix in §3 is that artifact.

The Cloud Services Security Policy (#24) and this policy are read together. Policy #24 is the rule; this matrix is the data. When a vendor is added, removed, or re-scoped, the matrix is the first place the change lands. The matrix is the source of truth for the §3 table; Policy #24 is the source of truth for the rule.

The matrix lives at `compliance/cloud/shared-responsibility-matrix.md` (versioned in git, updated when providers change). The matrix is also reproduced in §3 of this policy so the policy is a self-contained file (matching the format of the other 24 policies). The two copies are kept in sync; the canonical source is the policy file (because the policy file is reviewed and signed off by James and Raymond; the cloud/ copy is a reference).

## 2. The matrix legend

The matrix uses the **RACI** model, adapted for the cloud shared-responsibility context.

| Symbol | Meaning |
|---|---|
| **R** | **Responsible** — the party that does the work. The vendor or Solarpro performs the control activity. |
| **S** | **Shared** — both parties contribute. The control activity is a collaboration; the boundary is documented in the §4 per-vendor notes. |
| **A** | **Accountable** — the party that owns the outcome. For Solarpro-side controls, **A is always Solarpro** — we cannot outsource accountability. For vendor-side controls, A is the vendor (the vendor is accountable for the vendor's controls). |
| **I** | **Informed** — the party that is notified but does not perform the control. The notification is documented in the §4 per-vendor notes. |

The matrix is built so that **every cell has at least one R** (someone does the work) and **every row has at least one A** (someone owns the outcome). A cell with multiple R's is a shared control (both parties do part of the work); a cell with one R and one A means the A delegates to the R (the A is the owner, the R is the executor).

For the Solarpro column ("Solarpro" in the matrix), the **A is always Solarpro** (we own the outcome for any control that affects our data, our customers, or our compliance posture). For the vendor columns, the **A is the vendor** (the vendor owns the outcome for the vendor-side controls). The vendor's A is documented in the vendor's SOC 2 report; Solarpro's A is documented in the corresponding Solarpro policy.

## 3. The matrix

The matrix below covers **8 control areas × 12 vendors + Solarpro = 13 columns × 8 rows = 104 cells**. The cells use the RACI legend in §2. The §4 per-vendor notes provide the nuance for the cells that are not self-explanatory.

### 3.1 The control areas (rows)

1. **Data at rest encryption** — the encryption of stored data (the database, the object storage, the backups).
2. **Data in transit encryption** — the encryption of data on the wire (TLS, mTLS, VPN).
3. **Application code security** — the secure coding, the dependency management, the test coverage.
4. **Runtime / OS patching** — the patching of the runtime (Node.js, Python), the OS (the Vercel serverless host, the Render Docker host, the Neon compute), and the platform-managed services.
5. **Network security** — the firewall rules, the DDoS protection, the WAF, the network segmentation.
6. **Physical security** — the data center security (the building, the cameras, the badge readers).
7. **Identity & access management (IAM)** — the user accounts, the roles, the MFA, the SSO.
8. **Audit logging & monitoring** — the audit logs, the monitoring, the alerting, the incident detection.

### 3.2 The matrix table

| Control area | Vercel | Neon | Render | Cloudflare | GitHub | GCP | OpenAI | Anthropic | Stripe | Resend | Sentry | R2 | **Solarpro** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Data at rest encryption** | n/a (Vercel is stateless; no persistent storage) | R, A (Neon AES-256) | R, A (Render disk AES-256; ephemeral) | S, A (R2 AES-256; the IAM is Solarpro's) | I, A (GitHub secret scanning + the repo content) | n/a (GCP Solar API is read-only) | n/a (vision API is stateless; OpenAI may log per their terms — see §4.7) | n/a (vision API is stateless; Anthropic may log per their terms — see §4.8) | n/a (Stripe handles the card data; Solarpro sees the token) | n/a (Resend is stateless; the email content is the Solarpro payload) | n/a (Sentry stores error data; AES-256 at rest is Sentry's) | R, A (R2 AES-256; the bucket policy is Solarpro's) | **A** |
| **Data in transit encryption** | R, A (TLS 1.2+ at the edge; HSTS enabled) | R, A (TLS enforced; `sslmode=require` in the connection string) | R, A (TLS 1.2+ for inbound; TLS for outbound webhooks) | R, A (TLS 1.2+ at the edge; Cloudflare's "Full" SSL mode) | R, A (TLS 1.2+ for git + Actions; GitHub enforces) | R, A (TLS 1.2+ for the API; GCP enforces) | R, A (TLS 1.2+ for the API; OpenAI enforces) | R, A (TLS 1.2+ for the API; Anthropic enforces) | R, A (TLS 1.3 for Stripe Checkout + webhooks) | R, A (TLS 1.2+ for the API; MTA-STS for outbound) | R, A (TLS 1.2+ for the API; Sentry enforces) | R, A (TLS 1.2+ for the API; Cloudflare enforces) | **A** (the application-level HMAC + JWT) |
| **Application code security** | I, A (Vercel scans the deploy for known CVEs; the application code is Solarpro's) | I, A (Neon is the database; the application code is Solarpro's) | I, A (Render scans the Docker image; the application code is Solarpro's) | I, A (Cloudflare does not scan the application code) | R, S (GitHub provides Dependabot + CodeQL; the application code is Solarpro's) | I, A (GCP is a data source; the application code is Solarpro's) | I, A (OpenAI is an API; the application code is Solarpro's) | I, A (Anthropic is an API; the application code is Solarpro's) | I, A (Stripe is a payment processor; the application code is Solarpro's) | I, A (Resend is an email API; the application code is Solarpro's) | I, A (Sentry is a monitoring tool; the application code is Solarpro's) | I, A (R2 is storage; the application code is Solarpro's) | **R, A** (the application code is Solarpro's; per Policy #01, #23, #17) |
| **Runtime / OS patching** | R, A (Vercel manages the Node.js runtime + the serverless host OS) | R, A (Neon manages the Postgres version + the compute OS) | S, A (Render manages the host OS; Solarpro manages the Docker base image + the Python runtime) | R, A (Cloudflare manages the edge runtime) | R, A (GitHub manages the Actions runtime; Solarpro manages the Node.js version in `.nvmrc`) | R, A (GCP manages the API runtime) | R, A (OpenAI manages the API runtime) | R, A (Anthropic manages the API runtime) | R, A (Stripe manages the API runtime) | R, A (Resend manages the API runtime) | R, A (Sentry manages the API runtime) | R, A (Cloudflare manages the R2 runtime) | **A** (the Docker base image is Solarpro's; the patching is per Policy #23) |
| **Network security** | S, A (Vercel provides the edge firewall; the WAF rules are Solarpro's via Cloudflare) | R, A (Neon provides the network isolation; the IP allowlist is Solarpro's) | R, A (Render provides the network isolation; the firewall rules are Render's) | R, A (Cloudflare provides the DNS + WAF + DDoS protection) | R, A (GitHub provides the network isolation; the branch protection is Solarpro's) | R, A (GCP provides the API gateway; the API key is Solarpro's) | R, A (OpenAI provides the API gateway; the API key is Solarpro's) | R, A (Anthropic provides the API gateway; the API key is Solarpro's) | R, A (Stripe provides the API gateway; the API key is Solarpro's) | R, A (Resend provides the API gateway; the API key is Solarpro's) | R, A (Sentry provides the API gateway; the DSN is Solarpro's) | R, A (Cloudflare provides the R2 gateway; the API token is Solarpro's) | **A** (the application-level rate limiting + the WAF rules are Solarpro's; per Policy #15) |
| **Physical security** | R, A (Vercel's SOC 2 report covers the data center) | R, A (Neon's SOC 2 report covers the data center) | R, A (Render's SOC 2 report covers the data center) | R, A (Cloudflare's SOC 2 report covers the data center) | R, A (GitHub's SOC 2 report covers the data center) | R, A (GCP's SOC 2 report covers the data center) | R, A (OpenAI's SOC 2 report covers the data center) | R, A (Anthropic's SOC 2 report covers the data center) | R, A (Stripe's SOC 2 report covers the data center) | R, A (Resend's SOC 2 report covers the data center) | R, A (Sentry's SOC 2 report covers the data center) | R, A (Cloudflare's SOC 2 report covers the data center) | **I, A** (Solarpro is informed via the vendor SOC 2 report; the physical security is vendor-owned) |
| **Identity & access management (IAM)** | S, A (Vercel provides the role model; the user accounts + MFA are Solarpro's) | S, A (Neon provides the role model; the database user accounts are Solarpro's) | S, A (Render provides the role model; the user accounts + MFA are Solarpro's) | S, A (Cloudflare provides the role model; the user accounts + MFA are Solarpro's) | S, A (GitHub provides the role model; the user accounts + MFA are Solarpro's) | S, A (GCP provides the IAM; the user accounts + service accounts are Solarpro's) | n/a (OpenAI has no IAM; the API key is Solarpro's) | n/a (Anthropic has no IAM; the API key is Solarpro's) | S, A (Stripe provides the role model; the user accounts + MFA are Solarpro's) | S, A (Resend provides the role model; the API key is Solarpro's) | S, A (Sentry provides the role model; the user accounts + MFA are Solarpro's) | S, A (Cloudflare R2 provides the API token model; the API token is Solarpro's) | **R, A** (the user accounts, the roles, the MFA, the SSO are Solarpro's; per Policy #03, #15) |
| **Audit logging & monitoring** | S, A (Vercel provides the deploy logs; the application audit log is Solarpro's) | S, A (Neon provides the query logs; the application audit log is Solarpro's) | S, A (Render provides the service logs; the application audit log is Solarpro's) | S, A (Cloudflare provides the edge logs; the export to R2 is Solarpro's) | S, A (GitHub provides the Actions logs; the weekly digest is Solarpro's) | S, A (GCP provides the API logs; the export is Solarpro's) | S, A (OpenAI provides the usage logs; the Solarpro-side alert on cost is Solarpro's) | S, A (Anthropic provides the usage logs; the Solarpro-side alert on cost is Solarpro's) | S, A (Stripe provides the webhook logs; the application audit log is Solarpro's) | S, A (Resend provides the email logs; the application audit log is Solarpro's) | S, A (Sentry provides the error logs; the alert routing is Solarpro's) | S, A (Cloudflare provides the access logs; the export to git is Solarpro's) | **R, A** (the application audit log, the weekly monitoring, the Sentry alerts are Solarpro's; per Policy #08) |

### 3.3 The matrix summary

A few patterns emerge from the matrix:

- **For every vendor, the data encryption (rows 1-2) is the vendor's responsibility** (R) and the vendor is accountable (A). Solarpro's role for data encryption is the application-level (the bcrypt for passwords, the AES-256-GCM for TOTP, the HMAC for webhooks). The shared (S) cells are where Solarpro configures the vendor's encryption (the `sslmode=require` in the Neon connection string, the "Full" SSL mode in Cloudflare, the HSTS at the Vercel edge).
- **For every vendor, the physical security (row 6) is purely the vendor's** (R, A). Solarpro is informed (I) via the vendor's SOC 2 report. There is no shared responsibility for the physical layer.
- **For every vendor, the application code security (row 3) is Solarpro's** (R, A). The vendor scans for known CVEs (Vercel, Render, GitHub) but the application code is Solarpro's.
- **For every vendor, the IAM (row 7) is shared** (S, A) for the vendors that have a console (Vercel, Neon, Render, Cloudflare, GitHub, GCP, Stripe, Resend, Sentry, R2) and is Solarpro-only (n/a) for the API-only vendors (OpenAI, Anthropic). The API key is the IAM for the API-only vendors.
- **For every vendor, the audit logging (row 8) is shared** (S, A). The vendor provides the platform logs; Solarpro provides the application-level audit log. The export of the vendor logs to the Solarpro R2 evidence bucket is the long-term retention.

The matrix is the source of truth for the §3 of the Cloud Services Security Policy (#24). The matrix is updated when a vendor is added, removed, or re-scoped; the update is a PR with Raymond's review and James's approval.

## 4. Per-vendor notes

The §3 matrix is the high-level view. This section provides the per-vendor nuance for the cells that are not self-explanatory. The notes are the operational rule for the matrix.

### 4.1 Vercel

- **Data at rest**: Vercel is stateless for the Next.js application (no persistent storage; the function containers are ephemeral). The env vars are stored encrypted at rest by Vercel (the value is not visible after entry).
- **Application code**: Vercel scans the deploy for known CVEs in the npm dependencies. The application code is Solarpro's; the scanning is Vercel's value-add.
- **Network security**: Vercel provides the edge firewall (the IP allowlist, the rate limiting at the edge). The Solarpro-side rate limiting is in the application (per Policy #15 §6).
- **IAM**: Vercel provides the role model (Owner, Member, Billing). The user accounts + MFA are Solarpro's. The current Vercel team is 1 Owner (Raymond), 1 Member (Cody), 1 Billing (James).

### 4.2 Neon

- **Data at rest**: Neon AES-256 at rest. PITR backups are encrypted with the same key. The 7-day PITR window is the data-recovery mechanism.
- **Data in transit**: TLS enforced; `sslmode=require` is in the `DATABASE_URL`. The application uses the Neon serverless driver for the edge functions (the driver uses TLS by default).
- **Application code**: Neon is the database; the application code is Solarpro's. Neon does not scan the application code.
- **IAM**: Neon provides the role model (Admin, Member, Read-only). The database user accounts are Solarpro's. The current Neon project has 1 Admin (Raymond), 1 Member (Cody).

### 4.3 Render

- **Data at rest**: Render disk AES-256 at rest. The disk is ephemeral; the deploy is the source of truth. The model weights are in the deploy artifact.
- **Application code**: Render scans the Docker image for known CVEs. The application code + the Dockerfile are Solarpro's.
- **Runtime**: Render manages the host OS; Solarpro manages the Docker base image + the Python runtime. The base image is pinned by digest.
- **IAM**: Render provides the role model (Owner, Member). The current Render team is 1 Owner (Raymond), 1 Member (Cody).

### 4.4 Cloudflare

- **Data at rest**: Cloudflare R2 AES-256 at rest. The bucket is private; the access is via the API token.
- **Network security**: Cloudflare provides the DNS, the CDN, the WAF, the DDoS protection. The WAF rules are the Cloudflare managed rulesets plus 1-2 custom rules for the Solarpro-specific paths.
- **IAM**: Cloudflare provides the role model (Super Admin, Admin, Billing). The current Cloudflare account is 1 Super Admin (Raymond), 1 Admin (Cody), 1 Billing (James).

### 4.5 GitHub

- **Application code**: GitHub provides Dependabot + CodeQL + secret scanning. The application code is Solarpro's; the scanning is GitHub's value-add.
- **Runtime**: GitHub manages the Actions runtime; Solarpro manages the Node.js version in `.nvmrc`. The Actions workflows are in `.github/workflows/`.
- **IAM**: GitHub provides the role model (Owner, Member, Billing Manager). The current GitHub org is 1 Owner (Raymond), 1 Member (Cody), 1 Billing Manager (James).
- **Audit logging**: GitHub provides the Actions logs + the audit log. The Solarpro-side weekly digest exports the GitHub audit log to R2.

### 4.6 Google Cloud Platform (GCP)

- **Data in transit**: TLS 1.2+ for the Solar API + the Maps API. The API key is the IAM.
- **IAM**: GCP provides the IAM model (Owner, Editor, Viewer). The service account is Solarpro's; the API key is the practical IAM. The current GCP project has 1 Owner (Raymond) and the Solarpro service account for the API calls.

### 4.7 OpenAI

- **Data at rest**: OpenAI may log API requests for up to 30 days for abuse monitoring (per OpenAI's terms; the Zero Data Retention endpoint is available on request). Solarpro's default is the standard endpoint; the Zero Data Retention endpoint is a future option for high-sensitivity surveys.
- **Data in transit**: TLS 1.2+ for the API. The API key is the IAM.
- **Data residency**: OpenAI's data is stored in the US. The transfer mechanism for EU data subjects is the SCCs in the DPA.
- **Cost**: OpenAI GPT-4o is the default model. The `MAX_DAILY_COST_USD` + the `VISION_DAILY_BUDGET_USD` are the cost gates.

### 4.8 Anthropic

- **Data at rest**: Anthropic may log API requests per their terms (the API data is not used for training). The Zero Data Retention endpoint is available.
- **Data in transit**: TLS 1.2+ for the API. The API key is the IAM.
- **Data residency**: Anthropic's data is stored in the US. The transfer mechanism for EU data subjects is the SCCs in the DPA.
- **Cost**: Claude Sonnet 4.5 is the default; Claude Opus 4.8 is the high-accuracy fallback. The same cost gates apply.

### 4.9 Stripe

- **Data at rest**: Stripe is the payment processor; Solarpro never sees the card data. Stripe's tokenization means the Solarpro-side storage is the Stripe customer ID + the last 4 digits of the card. The PCI scope is Stripe's.
- **Data in transit**: TLS 1.3 for Stripe Checkout + the webhooks. The webhook signature is verified per Policy #21 §6.6.
- **IAM**: Stripe provides the role model (Owner, Admin, Read-only). The current Stripe account is 1 Owner (Raymond), 1 Admin (James for the billing), 1 Developer (Cody).

### 4.10 Resend

- **Data in transit**: TLS 1.2+ for the API. MTA-STS for outbound (recipient inboxes that enforce MTA-STS get TLS-only delivery).
- **IAM**: Resend provides the API key model. The API key is the IAM.
- **Domain verification**: The `solarpro.app` domain is verified in Resend with DKIM + SPF + DMARC. The DNS records are in Cloudflare.

### 4.11 Sentry

- **Data at rest**: Sentry stores the error events (the stack trace, the request metadata, the user context if provided). The PII in the error events is limited (the user context is the user ID, not the email or the name; the request body is redacted for the PII fields).
- **Data in transit**: TLS 1.2+ for the API. The DSN is the IAM.
- **IAM**: Sentry provides the role model (Owner, Admin, Member). The current Sentry org is 1 Owner (Raymond), 1 Member (Cody).

### 4.12 Cloudflare R2

- **Data at rest**: R2 AES-256 at rest. The bucket is private; the access is via the Cloudflare API token.
- **Data in transit**: TLS 1.2+ for the API. The API token is the IAM.
- **Lifecycle**: R2 lifecycle moves objects to the `Infrequent Access` storage class after 90 days and expires them after 7 years (the audit-evidence retention).
- **Versioning**: R2 versioning is enabled. Deleted objects are recoverable for the configured retention (90 days).

## 5. The "Solarpro is always A" principle

The §3 matrix has the **Solarpro** column with **A in every row**. The principle is: Solarpro is accountable for the outcome of every control that affects Solarpro data, Solarpro customers, or Solarpro's compliance posture — even when the work is delegated to a vendor.

- **Physical security (row 6)**: Solarpro is **I, A**, not just I. The vendor is R, A for the vendor-side work; Solarpro is informed (I) via the vendor's SOC 2 report AND accountable (A) for the outcome (the customer data is protected). If a vendor's physical security fails, Solarpro is accountable to the customer for the data — even though the work was the vendor's. This is the asymmetry of accountability in the cloud model: the customer is always accountable to the customer, even when the work is outsourced.
- **Application code (row 3)**: Solarpro is R, A. The vendor's scanning is value-add; the actual code is Solarpro's.
- **IAM (row 7)**: Solarpro is R, A. The vendor's role model is a tool; the user accounts, the MFA, the SSO, the access reviews are Solarpro's.
- **Audit logging (row 8)**: Solarpro is R, A. The vendor's logs are inputs; the Solarpro-side audit log, the weekly monitoring, the Sentry alerts are Solarpro's.

The "A is always Solarpro" principle is the rule that an auditor will check. The matrix documents it.

## 6. Updating the matrix

The matrix is updated when a vendor is added, removed, or re-scoped. The update is a PR with:

1. **The new row** (for a new vendor) or the **updated row** (for an existing vendor) in the §3 matrix.
2. **The new §4 per-vendor note** (for a new vendor) or the **updated note** (for an existing vendor).
3. **The CISO review** (Raymond's sign-off).
4. **The management sign-off** (James's approval).
5. **The merge commit** becomes the audit artifact of the change.

The update is also reflected in the `compliance/vendors.csv` and the Cloud Services Security Policy (#24) §2.

The matrix is reviewed annually as part of the §8 review. The annual review always includes a refresh of the §3 matrix (any vendor changes in the past 12 months) and a refresh of the §4 notes (any vendor feature changes).

## 7. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the matrix. Reviews every matrix change. Reviews the matrix annually. |
| **Technical lead** | **Cody** | Maintains the matrix. Implements the per-vendor configuration per the §3 cells. Runs the §6 of the Cloud Services Security Policy (#24) weekly config check. |
| **Management sign-off** | **James Carpenter** | Approves matrix changes. Signs off on the annual matrix review. |
| **All team members** | James, Raymond, Cody | Reports vendor changes (a new tool adopted ad-hoc, a vendor scope change) to Raymond within 1 business day. |

A violation (a vendor added without a matrix update, a per-vendor note that has drifted from the actual configuration) is handled per the Information Security Policy (#01) §9 and the Vendor Risk Management Policy (#10) §7.

## 8. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §3 matrix (any vendor changes), a refresh of the §4 notes (any vendor feature changes), and a refresh of the §2 legend (any RACI adaptations).
- **On material change** — within 30 days of any of: a new Tier 1 vendor, a Tier 1 vendor's security incident, a change in the Solarpro-side configuration that affects a §3 cell, or a new framework in scope (e.g. ISO 27017 A.5.23 may have new sub-controls in a future revision).
- **After every cloud incident** — the postmortem identifies gaps in the matrix (a cell that was R but should have been S, a cell that was I but should have been A). The gaps are updated in the matrix.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management, exceptions process.
- `compliance/policies/05-incident-response.md` — the operational rule for a vendor security incident.
- `compliance/policies/09-backup-recovery.md` — the data-recovery half; references the §3 data-at-rest row.
- `compliance/policies/10-vendor-risk-management.md` — the vendor risk management that drives the SOC 2 report collection.
- `compliance/policies/16-third-party-service-provider.md` — the people-side counterpart to the vendor-side (Policy #10).
- `compliance/policies/21-encryption-key-management.md` — the §3 data-at-rest and data-in-transit rows reference this policy.
- `compliance/policies/22-business-continuity-disaster-recovery.md` — the §6 cloud incident response that the matrix's "Shared" cells coordinate.
- `compliance/policies/23-patch-management.md` — the §3 runtime/OS-patching row references this policy.
- `compliance/policies/24-cloud-services-security.md` — the **paired narrative policy**. **Read together.**
- `compliance/CONTROL_MATRIX.md` — CC6.6, ISO 27017 A.5.23 evidence rows.
- `compliance/vendors.csv` — the 12-vendor sub-processor register.
- `compliance/cloud/shared-responsibility-matrix.md` — the versioned table copy of §3. Updated when providers change.
- `audit_security_migrations_2026-07-30.md` §2 — the rate-limiter and NODE_ENV gaps that this matrix documents the fix for.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 8-row × 12-vendor matrix (104 cells), the RACI legend, the "A is always Solarpro" principle, the per-vendor notes (Vercel, Neon, Render, Cloudflare, GitHub, GCP, OpenAI, Anthropic, Stripe, Resend, Sentry, R2), the matrix update procedure, and the "Solarpro is always A" asymmetry. The matrix is the per-vendor deep-dive that backs the Cloud Services Security Policy (#24) §3 narrative. Closes the ISO 27017 A.5.23 control (the cloud-specific shared-responsibility requirement). |
