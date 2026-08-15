# Cloud Services Security Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-024 — Cloud Services Security Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new Tier 1 vendor, new framework in scope, material change to an existing vendor's posture) |
| **Scope** | Every cloud service that Solarpro depends on for production operations. Today: Vercel (compute + edge), Neon (Postgres), Render (SAM2 service + worker), Cloudflare (DNS + CDN + R2), GitHub (source + Actions), Google Cloud Platform (Solar API, Maps), OpenAI (vision), Anthropic (vision), Stripe (payments), Resend (transactional email), Sentry (error monitoring). The policy covers the vendor-managed control surface and the Solarpro-managed configuration that sits on top. |

---

## 1. Purpose

This policy is the rule for **how Solarpro uses cloud services safely**. It's the **SOC 2 CC6.6 + ISO 27001 A.8.16 + ISO 27017 A.8.16** evidence: that Solarpro has an inventory of every cloud service it depends on, that the shared responsibility between Solarpro and the provider is documented for each service, that the Solarpro-side configuration is held to a documented standard, and that the configuration is monitored for drift.

Solarpro runs entirely on cloud infrastructure. There is no on-prem footprint. The physical-security controls (the locked data center, the badge reader, the surveillance camera) are inherited from Vercel, Neon, Render, and Cloudflare. The hypervisor, the network, the storage layer are all vendor-managed. Solarpro's job is to (a) verify the vendor's posture (via the SOC 2 report collection in the Vendor Risk Management Policy #10), (b) configure the service correctly (this policy), and (c) monitor the configuration for drift (this policy + the Logging & Monitoring Policy #08).

The Shared Responsibility Matrix (#25) is the per-vendor table that documents who owns what for each control area. This policy is the narrative; the matrix is the table. The two are read together.

The 2026-07-30 control matrix row A.8.16 (Monitoring activities) was Partial, and the cloud-specific risks that the audit flagged (vision fail-silent when API keys missing, the multi-tenant posture, the API quota overrun) are exactly the risks this policy is designed to address. The 2026-07-30 control matrix row CC6.6 (Logical access security) was Gap, with the rate-limiter fail-open and the NODE_ENV-as-Secure inconsistency as the P0 items. Those are addressed by the security quickwins PR and the rate-limiter fail-closed PR; this policy codifies the ongoing posture.

ISO 27017 is the cloud-specific control set. It is the standard the auditor will check for the cloud posture; this policy is the primary evidence for the ISO 27017 cluster.

## 2. The cloud service inventory

The cloud service inventory is the list of every cloud service that Solarpro depends on. The inventory is at `compliance/vendors.csv`; this section is the narrative view. The 12 vendors are grouped by the role they play in the stack.

### 2.1 Compute + edge

- **Vercel** — hosts the Next.js application. Vercel is the primary compute and edge layer. The Vercel project is `solarpro-web`; the production deployment is on the Vercel Pro plan. The edge handles HTTPS termination, the CDN, the serverless function execution, the cron jobs (`/api/cron/proposal-expiry`, `/api/cron/stale-job-cleanup`), and the environment variable management.
- **Render** — hosts the SAM2 Python service and the background worker. Render is the long-running compute layer. The Render service is `solarpro-sam2`; the production deployment is on the Render Standard plan. The service is Docker-based; the deploy artifact is the source of truth.

### 2.2 Data

- **Neon** — the Postgres database. Neon is the primary data store. The production project is in the `us-east-1` region (per the BC/DR Plan #22 §4.1, this is the region the team will revisit). Neon provides PITR (7-day window), branching for non-production environments, and the connection pooling.
- **Cloudflare R2** — the evidence store. R2 holds the audit evidence, the weekly monitoring digests, the vendor SOC 2 reports, and the policy snapshots. R2 is multi-region by default; versioning is enabled.

### 2.3 Network

- **Cloudflare** — DNS, CDN, WAF. Cloudflare sits in front of Vercel; the DNS for `solarpro.app` and the subdomains is on Cloudflare. The Cloudflare proxy provides DDoS protection, the WAF rules, and the rate-limiting rules. The Cloudflare R2 (above) and the Cloudflare Registrar (the domain registrar) are part of the same vendor relationship.

### 2.4 Source + CI/CD

- **GitHub** — the source code repository, the CI/CD pipeline (GitHub Actions), the issue tracker, and the security advisories. The GitHub org is `solarpro`; the production branch is `master`. The Dependabot configuration is in `.github/dependabot.yml`; the GitHub Actions workflows are in `.github/workflows/`.

### 2.5 ML/AI

- **OpenAI** — the vision API for the survey → planset pipeline. The model is `gpt-4o`; the API key is stored in Vercel env vars. The vision calls are made per-roof during the survey workflow.
- **Anthropic** — the vision API as a fallback to OpenAI. The models are `claude-opus-4-8` and `claude-sonnet-4-5`. The API key is stored in Vercel env vars.

### 2.6 Google Cloud Platform (GCP)

- **Google Solar API** — the solar resource data (irradiance, panel placement) used in the engineering pipeline. The API key is in Vercel env vars.
- **Google Maps Platform** — the address geocoding, the satellite imagery for the survey area. The API key is in Vercel env vars.

### 2.7 Payments

- **Stripe** — the payment processor. Stripe Checkout for the customer-facing payment; Stripe Billing for the subscription management. The API key is in Vercel env vars; the webhook secret is per the Encryption & Key Management Policy (#21) §6.6.

### 2.8 Email + monitoring

- **Resend** — the transactional email (account verification, password reset, DSR acknowledgement, proposal notification). The API key is in Vercel env vars; the domain `solarpro.app` is verified in Resend with DKIM + SPF + DMARC.
- **Sentry** — the error monitoring. The Sentry DSN is in Vercel env vars; the alerts route to Raymond and Cody.

### 2.9 The full inventory

The 12 vendors. The full vendor row (with the SOC 2 report date, the DPA status, the data classification, the contract renewal date) is in `compliance/vendors.csv`. The 12-vendor subset is the public Trust Center data; the full vendor row is the internal evidence.

| # | Vendor | Service | Role | Tier |
|---|---|---|---|---|
| 1 | **Vercel** | Compute + edge | App hosting | Tier 1 |
| 2 | **Neon** | Postgres | Database | Tier 1 |
| 3 | **Render** | Docker | SAM2 + worker | Tier 1 |
| 4 | **Cloudflare** | DNS + CDN + R2 | Network + storage | Tier 1 |
| 5 | **GitHub** | Source + CI/CD | Source control | Tier 1 |
| 6 | **Google Cloud Platform** | Solar API + Maps | Data enrichment | Tier 1 |
| 7 | **OpenAI** | Vision API | AI inference | Tier 1 |
| 8 | **Anthropic** | Vision API | AI inference | Tier 1 |
| 9 | **Stripe** | Payments | Billing | Tier 1 |
| 10 | **Resend** | Email | Transactional | Tier 2 |
| 11 | **Sentry** | Error monitoring | Observability | Tier 2 |
| 12 | **Cloudflare R2** | Object storage | Evidence | Tier 2 |

A "Tier 1" vendor is one whose outage or compromise would prevent Solarpro from serving customers. A "Tier 2" vendor is one whose outage would degrade the service but not prevent it. The tier drives the §4 config standard, the §5 monitoring cadence, and the §6 incident response priority.

## 3. Shared responsibility

The shared responsibility model is the rule for **who owns what**. For each cloud service, some controls are owned by the vendor (the physical security, the hypervisor, the network), some are shared (the data encryption, the IAM), and some are owned by Solarpro (the data classification, the application code, the access management).

The detailed matrix is in the Shared Responsibility Matrix (#25). This section summarizes the model.

### 3.1 What the vendor owns

- **Physical security** of the data center (the building, the cameras, the badge readers).
- **Hypervisor** security (the isolation between tenants on the same host).
- **Host OS** patching (the OS on the Vercel serverless host, the Render Docker host, the Neon compute).
- **Network infrastructure** (the fiber, the routers, the load balancers at the vendor's edge).
- **Storage layer** encryption (the AES-256 at rest, applied to the underlying disk).
- **Vendor-side audit logging** (the vendor's SOC 2 report covers the vendor's controls).

### 3.2 What Solarpro owns

- **Data classification** (the labels, the retention, the deletion per the Data Classification & Handling Policy #03 and the Data Retention & Disposal Policy #20).
- **Application code** (the secure coding, the dependency management, the test coverage per the Patch Management Policy #23).
- **IAM** (the user accounts, the roles, the MFA, the access reviews per the Access Control Policy #03).
- **Data encryption keys** (the JWT signing, the MFA TOTP key, the webhook secrets per the Encryption & Key Management Policy #21).
- **Audit logging** (the application-side audit log, the weekly monitoring digest per the Logging & Monitoring Policy #08).
- **Vendor risk management** (the SOC 2 report collection, the DPA filing, the vendor review per the Vendor Risk Management Policy #10 and the Third-Party Service Provider Policy #16).

### 3.3 What is shared

- **Network encryption** (the TLS at the vendor's edge is vendor-managed; the TLS within the application is Solarpro-managed).
- **Database encryption** (the storage-layer encryption is vendor-managed; the application-level encryption — bcrypt for passwords, AES-256-GCM for TOTP — is Solarpro-managed).
- **Incident response** (the vendor's incident response is vendor-managed; the Solarpro-side coordination is Solarpro-managed).

The boundary between vendor and Solarpro is documented per service in the Shared Responsibility Matrix (#25). The boundary is the operational rule; the §4 config standard enforces it.

## 4. Configuration standards

The configuration standards are the Solarpro-side rules for how each cloud service is configured. The standards are the **minimum** baseline; a stricter standard (e.g. a longer session timeout, a tighter IAM policy) is allowed.

### 4.1 Identity and access management (IAM)

- **MFA required on every cloud provider console** for every team member. MFA is enforced via the provider's console (Vercel, Neon, Render, Cloudflare, Stripe, Sentry, GitHub) or via Google Workspace SSO + MFA (the SSO provider enforces MFA on the downstream app). The MFA matrix is the Password & Authentication Policy (#15) §4.1 table.
- **Least privilege**. Every user gets the minimum role required. The Vercel team has 1 owner (Raymond), 1 member (Cody), 1 billing (James). The Neon project has 1 admin (Raymond), 1 member (Cody). The Render team has 1 owner (Raymond), 1 member (Cody). The GitHub org has 1 owner (Raymond), 1 member (Cody), with James as the billing manager. The Cloudflare account has 1 super-admin (Raymond), 1 admin (Cody), 1 billing (James).
- **No long-lived access keys**. Cloud provider access uses OIDC, short-lived tokens, or the provider's CLI (which uses OAuth + short-lived tokens). Long-lived AWS-style access keys are not used. The only exception is the GitHub Actions → Vercel/Render deploy tokens, which are short-lived (1 hour for Vercel, 24 hours for Render) and scoped to the deploy operation.
- **Service accounts are named, not generic**. The CI uses `ci-deploy` (the GitHub Actions deploy bot); the compliance collector uses `compliance-collector`; the SBOM generator uses `sbom-generator`. Generic accounts (`service`, `admin`, `bot`) are not used.
- **Quarterly access review** (the UAR per the Access Control Policy #03) reviews the cloud IAM state. The review is documented in `compliance/uar/`.

### 4.2 Data encryption

- **At rest**: AES-256, inherited from the provider (per the Encryption & Key Management Policy #21 §4 table).
- **In transit**: TLS 1.2+ (TLS 1.3 preferred), enforced at the provider's edge and within the application (per Policy #21 §5 table).
- **Key management**: provider-managed keys for the storage layer; Solarpro-managed keys for the application-level secrets (the JWT, the TOTP, the webhook secrets).

### 4.3 Network security

- **HTTPS-only** for all external traffic. HTTP is redirected to HTTPS at the Vercel edge.
- **HSTS enabled** with `max-age=63072000; includeSubDomains; preload`. The HSTS header is set at the Vercel edge.
- **Cloudflare proxy enabled** for the apex and the subdomains. The Cloudflare proxy provides the DDoS protection and the WAF.
- **Cloudflare WAF rules** for the common attack patterns (SQL injection, XSS, path traversal). The rules are the Cloudflare managed rulesets plus 1-2 custom rules for the Solarpro-specific paths.
- **No public buckets**. R2 buckets are private; the access is via the Cloudflare API token. A weekly check (§5) verifies no public bucket is created by accident.

### 4.4 Audit logging

- **Vendor-side audit logs are enabled** on every Tier 1 provider console. Vercel, Neon, Render, Cloudflare, GitHub, Stripe, Sentry, Resend, OpenAI, Anthropic, GCP all have audit logs.
- **Vendor audit logs are exported** to the Solarpro R2 evidence bucket where the provider supports it (Cloudflare, GitHub, Stripe, Sentry). The export is daily; the export is the long-term retention.
- **Application-side audit log** is the `audit_log` table in Neon. The audit log is append-only; the integrity is the append-only constraint plus the daily R2 export.
- **The combined audit posture** is documented per the Logging & Monitoring Policy (#08).

### 4.5 Configuration management

- **Infrastructure-as-code** for the configuration that can be IaC'd. The Cloudflare DNS is managed in the Cloudflare dashboard (the API is used for the weekly check). The Vercel project settings are in the Vercel dashboard. The Render service settings are in the Render dashboard.
- **Configuration drift detection** is the §5 weekly check.
- **`.env.example`** documents the expected env vars; the env-fingerprint artifact (`compliance/monitoring/env-fingerprint-<date>.json`) is the actual env state. The diff is the drift.

## 5. Configuration monitoring

The configuration standards are the rule; the configuration monitoring is the verification. The monitoring runs on a weekly cadence, automated where possible.

### 5.1 Weekly — automated config check

The weekly check is a GitHub Actions workflow (`compliance/monitoring/cloud-config-check.yml`); the workflow runs every Sunday at 06:00 UTC. The check covers:

- **MFA status** on every cloud provider console (verified via the provider's API or the SAML/OIDC assertion).
- **IAM user count** on every Tier 1 provider (alert if the count increases without a corresponding Linear issue).
- **Admin role assignments** (alert if a new admin role is granted without Raymond's approval).
- **Public buckets** on R2 and S3-compatible storage (alert on any public bucket; the Solarpro buckets are all private).
- **Exposed secrets** in the public GitHub repo (GitHub secret scanning; the workflow verifies no secret is in the public tree).
- **Env-var drift** between `.env.example` and the actual Vercel env vars (alert on any unexpected var or any missing required var).

The output is the weekly monitoring digest at `compliance/monitoring/YYYY-WW-digest.md`. Anomalies are flagged; the CISO reviews the digest on Monday morning.

### 5.2 Monthly — vendor posture review

The monthly review is a manual review of the vendor's security posture. The review covers:

- **Vendor security advisories** (the §4.5 of the Patch Management Policy #23).
- **Vendor SOC 2 report renewal** (the Vendor Risk Management Policy #10 §4).
- **DPA renewal** (the Third-Party Service Provider Policy #16 §5).
- **Vendor status page** (any recent incidents; any planned maintenance).
- **Vendor pricing changes** (any change to the plan tier or the per-unit pricing).

The output is a one-line entry in the monthly compliance digest. Action items are filed in Linear.

### 5.3 Quarterly — vendor risk register refresh

The quarterly refresh is the Vendor Risk Management Policy (#10) §5 review. The refresh covers all 12 vendors in the inventory. The output is the updated `compliance/vendors.csv` and the updated risk register in the control matrix.

### 5.4 Annual — vendor security review

The annual review is a deep-dive on the Tier 1 vendors. The review covers:

- **Vendor SOC 2 Type 2 report** (the current report; the next renewal date).
- **Vendor penetration test results** (the vendor's most recent pen test summary; the Solarpro-side pen test of the integration).
- **Vendor's incident history** (any incidents in the past 12 months; the Solarpro-side impact).
- **Vendor's roadmap** (any planned changes that affect Solarpro).
- **The Solarpro-side integration** (any drift in the §4 config standards).

The output is a vendor review report at `compliance/vendors/<vendor>-review-<year>.md`. The report is reviewed by James and Raymond.

## 6. Cloud incident response

A cloud incident is a security event or outage at one of the Tier 1 vendors. The response is the BC/DR Plan (#22) §6.7 + the Incident Response Plan (#05). This section is the cloud-specific coordination.

### 6.1 The vendor coordination

Every Tier 1 vendor has 24/7 support with a published SLA. The Solarpro-side coordination is:

- **Vercel** — Vercel Support (https://vercel.com/support) for non-Sev1; Vercel Status page (https://vercel-status.com) for Sev1; the on-call rotation is engaged via the status page.
- **Neon** — Neon Support (https://neon.tech/support); Neon Status (https://neonstatus.com). The PITR restore is a self-service operation; the support engagement is for confirmation.
- **Render** — Render Support (https://render.com/support); Render Status (https://status.render.com).
- **Cloudflare** — Cloudflare Support (https://support.cloudflare.com); Cloudflare Status (https://www.cloudflarestatus.com). The Enterprise plan has a dedicated TAM; Solarpro is on the Pro plan today.
- **GitHub** — GitHub Support (https://support.github.com); GitHub Status (https://www.githubstatus.com). The Enterprise plan has a dedicated support engineer; Solarpro is on the Team plan today.
- **Stripe** — Stripe Support (https://support.stripe.com); Stripe Status (https://status.stripe.com).
- **OpenAI, Anthropic, GCP, Resend, Sentry** — vendor-specific support pages; the response SLAs vary.

The coordination rule: **the vendor is the first responder**. Solarpro is the second. The vendor's incident response team is engaged before the Solarpro-side incident response; the vendor's status page is the authoritative source of truth for the incident scope and ETA.

### 6.2 The Solarpro-side response

The Solarpro-side response is the BC/DR Plan (#22) §6 (the per-scenario procedures) and the Incident Response Plan (#05) §5. The key cloud-specific additions:

- **The vendor's status page is monitored** in real-time during an incident. The monitoring is via the status page RSS feed + a Sentry alert if the page is unreachable.
- **The vendor's incident communication is the primary signal**. The Solarpro-side communication (the §6.1 of the BC/DR Plan #22) is the customer-facing translation.
- **The Solarpro-side postmortem** includes the vendor's incident timeline. The vendor's postmortem (if published) is referenced.

### 6.3 The after-action

The after-action is the Incident Response Plan (#05) §7 postmortem + the §10 review of the BC/DR Plan if the incident triggered a §6 procedure. The cloud-specific after-action is the §5.4 annual review if the incident was a vendor compromise.

## 7. Cloud-specific risks

The cloud posture introduces risks that the on-prem posture does not. The risks are documented in the risk register at the control matrix; this section is the narrative.

### 7.1 Multi-tenancy

Solarpro shares physical infrastructure with other Vercel, Neon, Render, and Cloudflare tenants. The vendor's hypervisor isolation is the primary control; the Solarpro-side controls are the IAM, the data encryption, and the audit logging. The 2026-07-30 control matrix row A.8.21 (Security of network services) is Gap (the rate-limiter fail-open is a multi-tenancy-adjacent risk); the gap is closed by the rate-limiter fail-closed PR.

### 7.2 Data residency

Solarpro data is stored in the vendor's region. The current default is US (us-east-1 for Neon, Vercel's US edge, Render's US region, Cloudflare's global anycast with R2 multi-region). For EU data subjects, the data residency is documented in the Privacy Policy (#18) §10. The transfer mechanism for EU → US is the Standard Contractual Clauses (SCCs) in the vendor DPAs.

### 7.3 Jurisdiction

The vendor's jurisdiction determines the legal framework for the data. The current default is US (Vercel US, Neon US, Render US, Cloudflare US, Stripe US, OpenAI US, Anthropic US, GCP US, Resend US, Sentry US). For EU customers, the SCCs are the transfer mechanism. For US customers, no transfer mechanism is required.

### 7.4 API quotas

Every vendor API has a quota or a rate limit. The quotas are documented per vendor; the Solarpro-side monitoring is in the §5 weekly check. A quota overrun is a Sev3 incident (degraded service, not outage).

### 7.5 Cost overruns

Every vendor bills per usage. A runaway loop in the application (e.g. the vision fail-silent + per-roof call) can produce a cost overrun. The 2026-07-30 control matrix row #10 (OpenAI/Claude fail-silent + no budget cap) is the trigger for the budget cap. The budget cap is the `MAX_DAILY_COST_USD` env var + the `VISION_DAILY_BUDGET_USD` env var. A daily cost that exceeds the cap is a Sev2 incident.

## 8. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the weekly config check. Triages cloud incidents. Coordinates with vendor support. |
| **Technical lead** | **Cody** | Implements the config standards. Maintains the env-fingerprint artifact. Runs the weekly config check. Co-runs the monthly vendor posture review. |
| **Management sign-off** | **James Carpenter** | Approves changes to the cloud inventory. Approves changes to the config standards. Signs off on the annual vendor security review. Approves cost-overrun exceptions. |
| **All team members** | James, Raymond, Cody | Uses the cloud provider consoles per the IAM rules (no sharing of accounts, no long-lived keys). Reports anomalies to Raymond within 1 business day. |

A violation (a public bucket, a long-lived access key, a missing MFA) is handled per the Information Security Policy (#01) §9 and the Vendor Risk Management Policy (#10) §7.

## 9. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §2 inventory (new vendors may have been added), a refresh of the §4 config standards (new vendor features may have been released), and a refresh of the §7 cloud-specific risks (new threat intel may have emerged).
- **On material change** — within 30 days of any of: a new Tier 1 vendor, a Tier 1 vendor's security incident, a change in the cloud posture (e.g. a move from Vercel Pro to Vercel Enterprise), a new framework in scope (e.g. FIPS 140-3 for a federal customer), or a change in the data residency requirements.
- **After every cloud incident** — the postmortem identifies gaps in the §4 config standards or the §6 coordination. The gaps are added to the §4 or §6.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 10. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management, exceptions process.
- `compliance/policies/05-incident-response.md` — the operational rule for a security incident.
- `compliance/policies/06-change-management.md` — when a cloud config change ships.
- `compliance/policies/08-logging-monitoring.md` — the audit logging posture that the §4.4 references.
- `compliance/policies/09-backup-recovery.md` — the data-recovery half of the BC/DR plan.
- `compliance/policies/10-vendor-risk-management.md` — the vendor risk management that drives the SOC 2 report collection.
- `compliance/policies/15-password-authentication.md` — the MFA matrix that the §4.1 IAM rules reference.
- `compliance/policies/16-third-party-service-provider.md` — the people-side counterpart to the vendor-side (Policy #10).
- `compliance/policies/17-software-bill-of-materials.md` — the SBOM that lists the cloud libraries.
- `compliance/policies/21-encryption-key-management.md` — the encryption posture that the §4.2 references.
- `compliance/policies/22-business-continuity-disaster-recovery.md` — the §6 incident response that the §6 cloud incident response coordinates with.
- `compliance/policies/23-patch-management.md` — the patch management that covers the cloud libraries.
- `compliance/policies/25-shared-responsibility-matrix.md` — the per-vendor table that the §3 shared responsibility references. **Read together.**
- `compliance/CONTROL_MATRIX.md` — CC6.6, A.8.16, ISO 27017 A.8.16 evidence rows.
- `compliance/vendors.csv` — the 12-vendor sub-processor register.
- `compliance/cloud/shared-responsibility-matrix.md` — the per-vendor deep-dive table.
- `audit_security_migrations_2026-07-30.md` §2 — the rate-limiter and NODE_ENV gaps that this policy codifies the fix for.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 12-vendor inventory (Vercel, Neon, Render, Cloudflare, GitHub, GCP, OpenAI, Anthropic, Stripe, Resend, Sentry, R2), the shared responsibility model (vendor / shared / Solarpro), the §4 configuration standards (IAM, encryption, network, audit logging, config management), the §5 weekly / monthly / quarterly / annual monitoring cadence, the §6 cloud incident response coordination, and the §7 cloud-specific risks (multi-tenancy, data residency, jurisdiction, API quotas, cost overruns). Closes the A.8.16 Partial row in the 2026-07-30 control matrix. The paired Shared Responsibility Matrix (#25) is the per-vendor table. |
