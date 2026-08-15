# Vendor Risk Management Policy

| Field | Value |
|---|---|
| **Policy** | POL-VEN-001 — Vendor Risk Management Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | Every third party that processes, stores, or transmits Solarpro data, or that operates a system Solarpro depends on for production. Includes sub-processors, infrastructure providers, AI/ML vendors, payment processors, and SaaS tools used by the team. |

---

## 1. Purpose

This policy is the rule for how we pick, monitor, and exit the third parties we depend on. It's the **SOC 2 CC9.2 + ISO 27001 A.5.19 / A.5.20 / A.5.21 / A.5.23 + ISO 27017 A.5.23** evidence: that Solarpro knows every vendor that touches its data, classifies them by criticality, applies proportionate due diligence, monitors them on a known cadence, and can wind them down cleanly when they are replaced.

Solarpro's stack is almost entirely third-party. Vercel, Neon, Render, Cloudflare, GitHub, Google Workspace, OpenAI, Anthropic, Stripe, Resend, Nearmap, Eagleview, ATTOM, and Google Solar together are the operational reality. The auditor will not accept "we use cloud providers" as an answer to "how do you manage vendor risk." The answer is: this policy, the inventory at `compliance/vendors.csv`, the DPA register, and the annual review.

This policy is paired with the Sub-Processor List published to customers (per the Data Classification & Handling Policy §2.5 and the upcoming Privacy Policy). The internal register and the public list are the same data; the public list is a curated subset.

## 2. Scope

This policy applies to every third party that meets **any** of the following criteria:

- **Processes Solarpro customer PII** (homeowner, inspector, or survey data).
- **Stores Solarpro production data** (the production database, the evidence store, the configuration store).
- **Operates a system Solarpro depends on for production** (the application runtime, the database, the CDN, the DNS, the email, the payment, the vision API, the model inference).
- **Has access to Solarpro customer accounts or credentials** (an integration, an OAuth scope, a service account).
- **Receives Solarpro source code or build artifacts** (GitHub, the IaC repos, any CI provider).

Out of scope: open-source dependencies that run inside the Solarpro application (covered by the Vulnerability Management Policy), free-tier SaaS tools used by individual team members that do not touch Solarpro data (e.g. a personal Gmail account), and one-off contractors (covered by the Acceptable Use Policy and a per-engagement NDA).

## 3. The vendor inventory

The vendor inventory lives at `compliance/vendors.csv` (being maintained in parallel by the compliance-lead agent; the schema is below). The inventory is the source of truth for "which vendors does Solarpro depend on, and what is their posture." The CSV is updated within 5 business days of any vendor change.

### 3.1 Schema

| Column | Type | Description |
|---|---|---|
| `vendor_id` | string | Stable internal ID, e.g. `v_001`. |
| `vendor_name` | string | Legal entity name, e.g. `Vercel Inc.`, `Neon Inc.`, `Stripe, Inc.`. |
| `service` | string | What Solarpro uses them for, e.g. `Application hosting`, `Postgres hosting`, `Payments`. |
| `tier` | enum | `Tier 1`, `Tier 2`, or `Tier 3` (see §4). |
| `data_accessed` | string | Concise description of the data they receive. |
| `data_classification` | enum | `Public`, `Internal`, `Confidential`, `Restricted` (per the Data Classification Policy). |
| `soc2_status` | enum | `Type 2 current`, `Type 2 expired`, `Type 1 only`, `Not obtained`, `Not applicable`. |
| `soc2_expiry` | date | Expiration of the current SOC 2 report, or `n/a`. |
| `dpa_status` | enum | `Signed`, `In progress`, `Not required`, `Not obtained`. |
| `dpa_expiry` | date | Expiration of the current DPA, or `n/a`. |
| `criticality` | enum | `Critical` (production-blocking), `Important` (degrades the product), `Standard` (operational). |
| `annual_review_due` | date | The next annual review. |
| `owner` | string | The Solarpro person who owns the relationship, e.g. `James`, `Raymond`, `Cody`. |
| `notes` | string | Anything else worth recording. |

The CSV is the single source of truth. The audit evidence (per §8) is a quarterly snapshot of the CSV plus the supporting documents.

## 4. Vendor classification

Every vendor is classified into one of three tiers. The tier drives the due diligence in §5 and the annual review cadence in §6.

### 4.1 Tier 1 — Critical / PII / production data

A vendor is Tier 1 if **any** of the following is true:

- They process or store Solarpro customer PII.
- They host the production database or the production application runtime.
- They have access to a Solarpro production credential (API key, OAuth token, service account).
- They are a payment processor or a sub-processor in the customer-data path.
- Their outage would take Solarpro's production service down.

**Due diligence**:

- **SOC 2 Type 2 report** — current (not expired). The report is reviewed by Raymond within 30 days of receipt.
- **DPA signed annually** — the Data Processing Agreement covers the data flows and the sub-processor list. The DPA is filed in R2 at `evidence/vendors/<vendor_id>/dpa-<date>.pdf`.
- **Security questionnaire** — Solarpro's standard questionnaire (or the vendor's SIG / CAIQ if it is more recent) is completed annually.
- **Sub-processor list** — the vendor's sub-processor list is reviewed; any new sub-processor in the customer-data path triggers a DPA amendment.
- **Vendor's incident history** — the past 24 months of the vendor's public security advisories are reviewed.

**Annual review cadence**: every 12 months, on the anniversary of the last SOC 2 report. The review confirms the SOC 2 is still current, the DPA is still signed, the sub-processor list has not changed materially, and no public incident has affected the data flows.

### 4.2 Tier 2 — Limited data / operational

A vendor is Tier 2 if they process limited data (operational metadata, no customer PII), or if they operate a non-customer-facing system.

**Due diligence**:

- **Security review** by Raymond — a documented assessment of the vendor's security posture, based on the vendor's published security page, any available SOC 2 / ISO 27001 report, and a completed security questionnaire (if not Tier 1).
- **DPA** — signed if PII is involved, even in a limited form.
- **Standard T&Cs** — the vendor's standard terms are accepted; deviations are reviewed by James.

**Annual review cadence**: every 12 months. Lighter than Tier 1; the SOC 2 is reviewed if available but not required.

### 4.3 Tier 3 — No data / tool

A vendor is Tier 3 if they receive no customer data, no production data, and no credentials. Examples: a marketing website analytics tool, a team-communication tool used on personal accounts.

**Due diligence**:

- **Standard T&Cs** — accepted as-is.

**Annual review cadence**: every 24 months, or on material change. Tier 3 vendors are reviewed as a group, not individually.

## 5. Current vendor list

The following is the operating vendor list as of the policy effective date. The CSV is the source of truth; this section is the human-readable snapshot for an auditor or a new team member.

### 5.1 Tier 1 — Critical / PII / production data

| Vendor | Service | Data accessed | DPA | SOC 2 | Owner | Notes |
|---|---|---|---|---|---|---|
| **Vercel Inc.** | Application hosting (Next.js) | All customer data in transit and at rest in the application | Required | Type 2 required | Cody | Inherits physical security for the application runtime. |
| **Neon Inc.** | Postgres hosting (production DB) | All production data, audit log | Required | Type 2 required | Cody | Inherits physical security and database encryption. PITR covered by the Backup & Recovery Policy. |
| **Render** | SAM2 service hosting (Python) | Aerial photos, model inputs/outputs | Required | Type 2 required | Cody | Inherits runtime security. |
| **OpenAI** | Vision API (GPT-4o) | Aerial photos, prompt context | **Required (P0 gap — see §5.2)** | Type 2 required | Raymond | Aerial photos of customer homes are PII. The DPA is the highest-priority open item. |
| **Anthropic** | Vision API (Opus 4.8, Sonnet 4.5) | Aerial photos, prompt context | **Required (P0 gap — see §5.2)** | Type 2 required | Raymond | Same as OpenAI. |
| **Google LLC** | Solar API (aerial imagery) | Aerial photos, address | Required | Type 2 required | Raymond | Sub-processor for the customer-data path. |
| **Stripe, Inc.** | Payment processing | Customer name, email, billing address, payment method | Required | Type 2 required | James | PCI DSS scope is Stripe's; Solarpro does not store PAN. |
| **Cloudflare, Inc.** | CDN, R2, DNS, WAF | Customer data in transit; evidence store at rest | Required | Type 2 required | Cody | R2 is the evidence store; multi-region. |

### 5.2 Tier 1 — P0 gaps (open at policy effective date)

The following Tier 1 items are open as of 2026-08-15 and are tracked as **P0** in `CONTROL_MATRIX.md`:

- **OpenAI DPA**: not yet filed. Aerial photos of customer homes are sent to the OpenAI Vision API. Required action: file a DPA covering the data flows. Target: Sprint 1, before the SOC 2 Type 1 audit field work begins.
- **Anthropic DPA**: not yet filed. Same as OpenAI. Target: Sprint 1.
- **Google Solar DPA**: not yet filed. Required for the address + aerial data flow. Target: Sprint 1.
- **Nearmap / Eagleview / ATTOM DPAs**: not yet filed. These are utility-data vendors. Tier 1 because the address-level data is PII-adjacent. Target: Sprint 2.

These are tracked in the `compliance/monitoring/vendor-dpa-pending.md` file. The gap is documented; the remediation is in flight; the auditor will see both.

### 5.3 Tier 2 — Operational

| Vendor | Service | Notes |
|---|---|---|
| **Resend** | Transactional email | Customer-facing email; DPA required. |
| **GitHub** | Source code hosting, CI | The Solarpro source code is here. Branch protection, secret scanning, Dependabot. |
| **Google Workspace** | Team email, calendar, docs | Internal use; no customer PII flows through Workspace in production. |

### 5.4 Tier 3 — Tool

| Vendor | Service | Notes |
|---|---|---|
| **1Password** | Team password manager | Internal credential storage. SOC 2 Type 2 in place. |
| **Slack** | Team communication | Internal. No customer PII. |

The list is not exhaustive. The CSV is.

## 6. Annual review

Every Tier 1 and Tier 2 vendor is reviewed annually. The review is owned by the relationship owner in §5.

### 6.1 The review packet

For each Tier 1 vendor, the annual review produces:

1. **Current SOC 2 Type 2 report** (or ISO 27001 certificate) — requested from the vendor 60 days before the anniversary. If the vendor cannot produce a current report, that is itself a finding and triggers a Tier-1-to-Tier-2 review.
2. **Renewed DPA** — signed before the prior DPA expires. The DPA template is at `compliance/templates/dpa-template-v1.md`. The signed DPA is filed in R2.
3. **Updated security questionnaire** — Solarpro's standard questionnaire or the vendor's SIG / CAIQ, whichever is more recent.
4. **Sub-processor list** — the vendor's current list, reviewed for any new sub-processor in the customer-data path.
5. **Incident review** — the past 12 months of the vendor's public security advisories, reviewed for any incident affecting the data flows.
6. **Criticality re-evaluation** — is the vendor still Tier 1? Has the data flow changed? Has Solarpro's reliance on the vendor changed?
7. **Open findings** — any open audit findings from the prior year, status update.

For Tier 2 vendors, the packet is shorter: the security review, the DPA (if applicable), and the criticality re-evaluation.

For Tier 3 vendors, the review is a group review every 24 months.

### 6.2 The review record

The output of the annual review is a markdown file at `evidence/vendors/<vendor_id>/review-<year>.md` with the seven items above. The file is referenced from the CSV (`notes` column) and from the next SOC 2 audit evidence packet.

A vendor that misses the annual review is escalated to James. A Tier 1 vendor that cannot produce a current SOC 2 within 90 days of the anniversary is downgraded to Tier 2 pending the report, or offboarded per §7.

## 7. Offboarding

When a vendor is replaced, the relationship is wound down per a documented checklist. The offboarding is owned by the relationship owner; the security review is owned by Raymond.

### 7.1 The offboarding checklist

1. **Identify all data held by the vendor** — what Solarpro data is in the vendor's systems? The vendor's data map is the source. For Tier 1, this is a contractual right under the DPA.
2. **Retrieve the data** — every artifact that Solarpro needs to retain (export the production data, export the audit log, export the configuration, export the integration credentials).
3. **Confirm deletion** — the vendor provides written confirmation that the data is deleted from their production systems, backups, and caches. The confirmation is filed in R2 at `evidence/vendors/<vendor_id>/offboarding-deletion-<date>.pdf`. The DPA's data-return-and-deletion clause is the contractual basis.
4. **Rotate credentials** — every credential the vendor had access to is rotated. The credential rotation follows the Change Management Policy. The rotation is logged in `auditLog.ts`.
5. **Terminate the DPA** — written notice to the vendor per the DPA's termination clause. The termination date is recorded.
6. **Remove the integration** — every line of code, every environment variable, every CI secret, every OAuth scope that referenced the vendor is removed. The removal is a PR with the standard four-gate review.
7. **Update the inventory** — the vendor is removed from `compliance/vendors.csv`. The `vendor_id` is not reused.
8. **Notify customers** — if the vendor was a sub-processor in the customer-data path, customers are notified per the Data Classification & Handling Policy §2.5 and the customer-facing Sub-Processor List. The notice period matches the DPA's sub-processor-change clause (typically 30 days).

### 7.2 The "no orphaned credentials" rule

A credential that the offboarded vendor had access to is rotated within 7 days of the offboarding decision, regardless of when the vendor confirms deletion. The credential rotation is the immediate containment; the deletion confirmation is the cleanup.

## 8. Evidence

The vendor risk management program produces the following evidence, stored in the Solarpro R2 evidence bucket:

- **Vendor inventory** at `evidence/vendors/inventory-<date>.csv` (quarterly snapshot of `compliance/vendors.csv`).
- **DPAs** at `evidence/vendors/<vendor_id>/dpa-<date>.pdf`.
- **SOC 2 reports** at `evidence/vendors/<vendor_id>/soc2-<date>.pdf`. These are confidential; the auditor access flow at `compliance/SELF_BUILT_SETUP.md` controls who can read them.
- **Annual review records** at `evidence/vendors/<vendor_id>/review-<year>.md`.
- **Security questionnaires** at `evidence/vendors/<vendor_id>/questionnaire-<date>.pdf`.
- **Offboarding records** at `evidence/vendors/<vendor_id>/offboarding-<date>.md`.
- **DPA-pending tracker** at `compliance/monitoring/vendor-dpa-pending.md` (the live list of open Tier 1 DPAs).
- **Sub-processor list** (the customer-facing list at `/sub-processors` on the public site, generated from the inventory).

The combination is the **SOC 2 CC9.2 + ISO 27001 A.5.19 / A.5.20 / A.5.21 / A.5.23** audit evidence: a current vendor inventory, proportionate due diligence, documented reviews, and verifiable offboarding.

## 9. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the security posture of every Tier 1 vendor. Owns the DPA-pending tracker. Approves criticality changes. |
| **Commercial relationship owner** | **James Carpenter** (default for Tier 1) | Owns the commercial relationship. Signs DPAs. Approves offboarding decisions. |
| **Technical relationship owner** | **Cody** | Owns the technical integration. Runs the offboarding checklist for the integration side. |
| **Management sign-off** | **James Carpenter** | Approves Tier 1 vendor additions, Tier 1 vendor downgrades, and any offboarding that affects the customer-data path. |

A new vendor that handles customer PII is a Tier 1 change under the Change Management Policy and requires James's approval before the DPA is signed. A new vendor that does not handle customer PII requires Raymond's review and is approved as a Normal change.

## 10. Exceptions

Exceptions to this policy follow the standard exception process in the Information Security Policy §8:

1. **Documented** in a Linear issue tagged `compliance-exception`.
2. **Approved by Raymond** with a stated duration (max 90 days without re-approval).
3. **Disclosed to James** if the exception involves a P0 control, a customer-data path, or a customer commitment.

The most common exception in year 1 is "the SOC 2 report is in flight and the current report is the Type 1." The exception is time-bounded to the expected Type 2 issuance date.

## 11. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/04-data-classification-handling.md` — what data is PII, what the sub-processor list looks like.
- `compliance/policies/05-incident-response.md` — when a vendor has an incident that affects Solarpro.
- `compliance/policies/06-change-management.md` — when a new vendor is added.
- `compliance/policies/09-backup-recovery.md` — when a vendor's data is part of the recovery.
- `compliance/CONTROL_MATRIX.md` — CC9.2, A.5.19, A.5.20, A.5.21, A.5.23, A.8.23 current state and evidence.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection, R2 bucket, auditor access flow.
- `compliance/vendors.csv` — the inventory.
- `compliance/monitoring/vendor-dpa-pending.md` — the open DPA tracker.
- `compliance/templates/dpa-template-v1.md` — the DPA template (forthcoming).
- `audit_solar_ml_2026-07-30.md` §5, `audit_consolidated_2026-07-30.md` §7 — the open DPAs that this policy tracks.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the three-tier classification, the due diligence requirements per tier, the annual review cadence, the eight-step offboarding checklist, and the current operating vendor list (Vercel, Neon, Render, OpenAI, Anthropic, Google Solar, Stripe, Cloudflare, plus Tier 2 and Tier 3). Tracks the four open Tier 1 DPAs (OpenAI, Anthropic, Google Solar, Nearmap/Eagleview/ATTOM) as P0 items. |
