# Third-Party Service Provider Policy

| Field | Value |
|---|---|
| **Policy** | POL-VEN-002 — Third-Party Service Provider Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | Every external party — individual or organization — that accesses Solarpro data, Solarpro systems, or Solarpro personnel, regardless of engagement type. Includes contractors, freelancers, consultants, agency partners, contract engineers, design firms, security/IR firms, and partner companies with shared customer accounts. |

---

## 1. Purpose

This policy is the rule for bringing humans from outside the company into Solarpro's data and systems, and for letting them leave. It's the **SOC 2 CC9.2 + ISO 27001 A.5.19 / A.5.20 / A.5.21 / A.5.23** evidence: that Solarpro knows every third party with access, classifies the access, applies proportionate due diligence (NDA, security questionnaire, background check where the access warrants it, SOC 2 report where the data warrants it), monitors the relationship, and winds it down cleanly when it ends.

Policy 10 (Vendor Risk Management, `10-vendor-risk-management.md`) covers the SaaS and infrastructure side: every cloud service, payment processor, or sub-processor that Solarpro depends on. This policy is the companion that covers the **people side**: every human at another organization that handles Solarpro data, touches Solarpro systems, or interacts with Solarpro customers on Solarpro's behalf. The two policies are read together; the Sub-Processor List at `compliance/vendors.csv` is the public subset of both.

The 3-person Solarpro team — James, Raymond, Cody — does the day-to-day work, but every external engagement that touches data, systems, or customers passes through this policy. A copywriter who writes blog posts in a personal Google Doc does not. A contract engineer who gets read access to the production codebase does. The boundary is access, not employment.

## 2. Scope

This policy applies to any external party that meets **any** of the following criteria:

- **Accesses Solarpro data** — production data, customer PII, internal documents, financial records, audit logs, source code, customer support conversations.
- **Accesses Solarpro systems** — GitHub org, Vercel/Render/Neon/Cloudflare/Stripe/Resend consoles, Google Workspace, the production database, the audit log, the evidence store, the SAM2 service.
- **Accesses Solarpro customer accounts** — provides support, sales engineering, professional services, training, configuration, or any other customer-facing service on Solarpro's behalf.
- **Receives Solarpro source code or build artifacts** — contractor development, code review, security testing, audit, agency work.
- **Handles Solarpro customer PII or restricted data** — even briefly, even on a sandbox, even via a sub-processor relationship.
- **Represents Solarpro externally** — speaks at conferences, posts on social media as a Solarpro representative, signs contracts on Solarpro's behalf, or otherwise creates reputational or legal exposure.

**Out of scope:**

- SaaS vendors with no human-in-the-loop data access (covered by POL-VEN-001 Vendor Risk Management).
- Open-source dependencies (covered by POL-OP-007 Vulnerability Management and the SBOM Policy, POL-IS-016).
- Free-tier SaaS tools used by individual team members on personal accounts (covered by POL-IS-002 Acceptable Use).
- Customers, homeowners, and other end users (covered by the Privacy Policy, POL-PRV-001, and the Data Subject Rights Policy, POL-PRV-002).

The boundary is intentionally inclusive. "Out of scope" is the smaller list. When in doubt, the engagement is in scope and this policy applies.

## 3. Third-party classification

Every third-party engagement is classified into one of three tiers, based on the **most sensitive access the engagement requires**. The tier drives the due diligence in §4 and the monitoring cadence in §6.

### 3.1 Tier A — Production data or PII access

An engagement is Tier A if the third party will, at any point during the engagement, see or handle:

- **Customer PII** (homeowner names, addresses, photos, contact info, utility data).
- **Production data** (the live database, the audit log, the production secrets, the production credentials).
- **Production credentials** (a production API key, a service account, an OAuth scope, a JWT signing key, a database URL, an admin break-glass secret).
- **Production source code with secrets** (the application source as deployed, even without secrets; the threat is the combination of code familiarity and a future access).
- **Customer-facing systems on behalf of Solarpro** (a customer support inbox, a customer data export, a customer account impersonation).

**Examples at Solarpro today:** a contract engineer with read access to the production database for a specific migration task; an outside security firm doing a penetration test; an IR retainer firm; a customer-success contractor who logs into customer accounts to provide support; a translation contractor who sees customer-facing text that includes customer names or addresses.

### 3.2 Tier B — Limited data or non-production access

An engagement is Tier B if the third party will see Solarpro data or systems that do **not** include Restricted data:

- **Internal data** (the policy library, internal docs, internal Slack history, internal financial reports).
- **Non-production source code** (a feature branch, a docs PR, a sandbox).
- **Staging or test environments** that contain non-production data (test fixtures, generated data, the contractor's own test data).
- **Customer-facing systems for design or content work** (a copywriter reviewing customer-facing text, a designer reviewing a customer-facing screen, a UX researcher watching a usability session with consent).
- **The Solarpro GitHub org** (read access to public or internal repos, no admin role, no production access).

**Examples at Solarpro today:** a contract frontend engineer on a 2-month sprint; a design contractor working on the marketing site; a copywriter reviewing help-center articles; a security consultant reviewing the policy set; an external auditor engaged for a readiness assessment.

### 3.3 Tier C — No data, no systems

An engagement is Tier C if the third party represents Solarpro externally but does not see Solarpro data, systems, or production credentials:

- A conference speaker on a Solarpro topic (the talk is reviewed and approved before delivery; the speaker is acting as a representative, not accessing data).
- A board advisor (no operational access; advises James on company direction).
- A legal counsel (privileged communication; no production access; covered by attorney-client privilege).
- An accountant or tax preparer (sees financial records that are not customer PII; no system access).

**Examples at Solarpro today:** the village of Old Ripley's township attorney (civic role, not Solarpro); an external accountant preparing Solarpro's annual filings; a future board advisor.

## 4. Pre-engagement due diligence

Before a third-party engagement begins — before any data is shared, any account is provisioned, any system access is granted — the following steps are completed and documented. The exact steps depend on the tier.

### 4.1 Step 1 — Engagement request

Any team member can propose a third-party engagement. The proposal includes:

- **Who** — the third party (individual name + organization, if any).
- **What** — the scope of work, in plain language.
- **Why** — the business reason.
- **When** — the engagement window (start date, end date, ongoing?).
- **What access** — the specific Solarpro data, systems, or customer accounts the engagement requires.
- **Proposed tier** — A, B, or C per §3, with a one-paragraph justification.

The proposal is filed in Linear (or, if no Linear, a GitHub issue) tagged `third-party-engagement` and is assigned to **James** for commercial sign-off and **Raymond** for security review. The two-step approval is required regardless of tier.

### 4.2 Step 2 — NDA

Every Tier A and Tier B engagement is gated by a signed Non-Disclosure Agreement. The NDA template is at `compliance/templates/nda-template-v1.md` (forthcoming). For Tier C, an NDA is recommended but not required; James may waive it in writing for low-risk representations.

The NDA is signed by the third party (or, for an organization, by an authorized signatory) before any data or system access. The signed NDA is filed at `compliance/third-parties/<engagement_id>/nda-<date>.pdf`.

### 4.3 Step 3 — Security questionnaire (Tier A and B)

For Tier A and Tier B engagements, the third party completes a security questionnaire before access is granted. The questionnaire template is at `compliance/templates/security-questionnaire-v1.md` (forthcoming). The questions cover:

- The third party's information security program (policies, training, MFA, access control).
- The third party's data handling practices (encryption at rest and in transit, retention, deletion on engagement end).
- The third party's incident history and breach notification commitments.
- The third party's sub-contractor list (if the third party will use sub-contractors to deliver the work).
- The third party's regulatory environment (SOC 2, ISO 27001, HIPAA, PCI DSS — whichever apply).

The questionnaire is reviewed by Raymond. The review produces a one-paragraph decision: **approved / approved with conditions / declined / needs more info**. The decision is filed at `compliance/third-parties/<engagement_id>/questionnaire-review-<date>.md`.

For Tier C, the questionnaire is not required. James makes the call on whether one is useful (e.g., for a board advisor who will see strategic plans).

### 4.4 Step 4 — Background check (Tier A only, where PII or production access is in scope)

For Tier A engagements where the third party will handle customer PII or hold production credentials, **a background check is required before access is granted.** The check is the same scope as the Background Check Policy (POL-HR-014 §3): identity verification, criminal background (7-year county/state/federal), employment history, references.

The check is performed by a third-party screening vendor. Per POL-HR-014 §7, the operational execution of background checks is currently **deferred until operating budget permits** the screening-vendor line item. The compensating control today is:

- **For individual contractors**: an in-person or video interview with James and Raymond, with reference calls to two named references. The reference calls are documented in the engagement file.
- **For agency / firm engagements**: a written attestation from the firm's authorized signatory that the assigned personnel have been screened to at least the POL-HR-014 §3 standard, and the right to audit that attestation at any time during the engagement.

The compensating control is documented in the engagement file. When the screening-vendor line item becomes affordable, the compensating control is replaced with the formal check.

### 4.5 Step 5 — DPA where PII is in scope (Tier A only)

For Tier A engagements where the third party will handle customer PII, **a Data Processing Agreement is required** before PII is shared. The DPA covers:

- The data flows (what PII, what direction, what volume).
- The sub-processor list (any sub-processor the third party uses to deliver the work).
- The security commitments (encryption, access control, breach notification).
- The data return / deletion commitment on engagement end.
- The audit right (Solarpro's right to verify the third party's compliance).

The DPA template is at `compliance/templates/dpa-template-v1.md` (forthcoming). The signed DPA is filed at `compliance/third-parties/<engagement_id>/dpa-<date>.pdf`. This step is the same as the Tier 1 vendor requirement in POL-VEN-001 §4.1 and is tracked in the same `compliance/monitoring/vendor-dpa-pending.md` registry.

### 4.6 Step 6 — Access provisioning

Once steps 1-5 (as applicable) are complete, the access is provisioned per the Access Control Policy (POL-IS-004). The provisioning follows the principle of **least privilege**: the third party gets exactly the access the engagement requires, for exactly the engagement window. The access grant is recorded in `auditLog.ts` with the engagement ID, the tier, and the approver.

For Tier A engagements, the access is **time-bounded** (auto-revokes on the engagement end date unless renewed). For Tier B, time-bounded access is recommended but not required. For Tier C, no system access is granted.

### 4.7 What if a step fails?

If any step fails — the NDA is not signed, the questionnaire is incomplete, the background check returns a disqualifying offense, the DPA is not signed, the reference check surfaces a red flag — the engagement is paused. The pause is communicated to the third party by James (for commercial reasons) or Raymond (for security reasons). The pause is logged in the engagement file with the reason and the date.

A failed step is not necessarily a permanent block. A reference check red flag is reviewed case-by-case; a missing NDA can be cured by signing; a disqualifying background-check offense is a permanent block for Tier A. The principle: a documented decision is better than a quiet rejection.

## 5. Contractual terms

The engagement is formalized by a contract (Master Services Agreement, Statement of Work, or equivalent). The contract includes the standard terms below, in addition to the commercial terms. The contract is reviewed by James (commercial) and Raymond (security) before signature.

### 5.1 Confidentiality

The third party agrees to keep Solarpro data confidential. The confidentiality term survives the engagement end for a minimum of **3 years** for Tier A and **2 years** for Tier B, or longer if required by applicable law. The confidentiality term is backed by the NDA (§4.2) — the two are layered, not duplicative.

### 5.2 Breach notification

The third party agrees to notify Solarpro of any actual or suspected security incident affecting Solarpro data **within 72 hours of detection**. The notification goes to `security@solarpro.app` and includes the data affected, the timeline, the containment steps taken, and the contact for follow-up. The 72-hour clock matches GDPR Article 33 (the standard for PII controllers reporting to supervisory authorities) and is the minimum; a faster notification is always acceptable.

This 72-hour term is the **SOC 2 CC7.4 + ISO 27001 A.5.26** evidence: that Solarpro has a contractual mechanism to learn about a third-party incident before the third party's customers or the public do.

### 5.3 Data return and deletion on termination

The third party agrees to return or securely delete all Solarpro data within **30 days of engagement end**, with written confirmation. The confirmation is filed at `compliance/third-parties/<engagement_id>/deletion-<date>.pdf`. For Tier A, the confirmation includes a list of systems from which the data was deleted and the method of deletion (secure delete, cryptographic erasure, or physical destruction of media).

This is the **SOC 2 CC6.5 + ISO 27001 A.8.10** evidence: that Solarpro has a contractual mechanism to ensure its data is not retained by a third party after the engagement ends.

### 5.4 Audit rights

For Tier A engagements, Solarpro reserves the right to audit the third party's compliance with the security and data-handling terms of the contract, on reasonable notice (typically 30 days), at Solarpro's expense. The audit right is exercised at James's discretion and is typically waived if the third party holds a current SOC 2 Type 2 report covering the relevant controls. For Tier B, the audit right is recommended; for Tier C, it is not typically included.

### 5.5 Insurance

For Tier A and B engagements with a contract value above **$10,000 USD** (or any engagement that involves customer-facing work), the third party carries commercial general liability insurance and, where the engagement involves PII, cyber liability insurance with a minimum coverage of $1M per occurrence. The certificate of insurance is filed in the engagement folder.

## 6. Monitoring

Every third-party engagement is monitored on a tier-appropriate cadence. The monitoring ensures the engagement stays within scope, the access stays proportionate, and the third party remains in good standing.

### 6.1 Continuous monitoring — every engagement

- **Access logs**: every access by the third party is logged in `auditLog.ts` and reviewed monthly by Raymond. The review looks for: out-of-scope resource access, after-hours activity, anomalous volume.
- **Engagement end date**: every Tier A access grant is time-bounded. The auto-revoke job (the same one that handles employee offboarding per POL-HR-012 §6) revokes access on the engagement end date unless the engagement is renewed.
- **Incident alerts**: any Sentry alert, Dependabot alert, or `auditLog.ts` event tagged with the third party's identity is routed to Raymond.

### 6.2 Quarterly review — Tier A

Every Tier A engagement is reviewed at the end of each quarter. The review is owned by Raymond and covers:

- The access actually used during the quarter (compared to the access granted).
- Any incidents or near-misses involving the third party.
- Any change in the third party's posture (a published breach, a leadership change, a SOC 2 lapse).
- The ongoing need for the engagement (is it still active? Is the tier still right?).

The review produces a one-page note at `compliance/third-parties/<engagement_id>/review-<year>Q<n>.md`. If the review surfaces a concern, the concern is escalated to James.

### 6.3 Annual review — Tier A and B

Every Tier A and Tier B engagement is reviewed annually. The review is the same content as the quarterly review, plus:

- A renewal of the NDA, DPA, and questionnaire (if still active).
- A re-confirmation of the SOC 2 report (if the third party is large enough to have one).
- A re-evaluation of the tier (is the engagement still Tier A? has the access scope changed?).

The annual review produces a markdown file at `compliance/third-parties/<engagement_id>/review-<year>.md`, following the same structure as the POL-VEN-001 §6.1 vendor review packet.

### 6.4 Material event monitoring — every tier

The following events trigger an immediate review of every active third-party engagement, regardless of tier:

- The third party publishes a security advisory or breach notification.
- The third party's SOC 2 report lapses or is qualified.
- A leadership change at the third party (a new CISO, a new CEO, an acquisition).
- A regulatory action against the third party (an FTC settlement, a GDPR fine, a class-action lawsuit).
- A sub-processor change at the third party (a new sub-processor in the Solarpro data path).
- A change in the third party's insurance status.

The review is owned by Raymond. The outcome is one of: continue, continue with new conditions, suspend, terminate.

## 7. Offboarding

When a third-party engagement ends — for any reason: completion, cancellation, breach, mutual decision, or non-renewal — the offboarding is owned by the relationship owner (typically James for commercial, Raymond for security) and follows the eight-step checklist below. The checklist is the **SOC 2 CC6.5 + ISO 27001 A.5.21 + ISO 27701 6.10** evidence: that Solarpro can cleanly sever a third-party relationship without leaving orphaned access, retained data, or unrevoked credentials.

### 7.1 The offboarding checklist

1. **Identify all Solarpro data held by the third party.** For Tier A, this is a contractual right under §5.3 and the DPA. For Tier B, the third party cooperates on a best-efforts basis. The output is a list of systems, databases, backups, caches, and paper records.
2. **Retrieve the data.** Every artifact that Solarpro needs to retain is returned to Solarpro in a standard format (CSV, JSON, PDF) within the §5.3 30-day window. For Tier A PII, the data is encrypted in transit (TLS) and at rest (Solarpro's standard).
3. **Confirm deletion.** The third party provides written confirmation that the data is deleted from their production systems, backups, caches, and any sub-processor systems. The confirmation is filed at `compliance/third-parties/<engagement_id>/deletion-<date>.pdf`. For Tier A, the confirmation includes the deletion method.
4. **Rotate credentials.** Every Solarpro credential the third party had access to is rotated. The rotation follows the Change Management Policy (POL-OP-003) and is logged in `auditLog.ts`. The rotation is the immediate containment; the deletion confirmation is the cleanup. **The rotation happens within 7 days of the offboarding decision, regardless of when the deletion confirmation arrives.**
5. **Terminate the contract.** Written notice to the third party per the contract's termination clause. The termination date is recorded. For Tier A, the termination is also reported in the next SOC 2 audit cycle.
6. **Remove the access.** Every account, OAuth scope, API key, SSH key, database role, and admin grant for the third party is revoked. The removal is verified by Raymond within 24 hours of the offboarding decision. The verification is logged in `auditLog.ts`.
7. **Update the inventory.** The third party is removed from `compliance/vendors.csv` (if the engagement was the source of a sub-processor entry) and the engagement record is moved to `compliance/third-parties/_archive/<year>/<engagement_id>/`. The engagement_id is not reused.
8. **Notify downstream parties.** If the third party was in the customer-data path, customers are notified per the Privacy Policy (POL-PRV-001 §6) and the Data Subject Rights Policy (POL-PRV-002). The notice period matches the contract's sub-processor-change clause (typically 30 days) or the Privacy Policy's sub-processor-change notice (30 days), whichever is longer.

### 7.2 The "no orphaned credentials" rule

A credential that the offboarded third party had access to is rotated within 7 days of the offboarding decision, **regardless of when the third party confirms deletion.** The credential rotation is the immediate containment; the deletion confirmation is the cleanup. This rule is non-negotiable for Tier A.

### 7.3 Post-offboarding review

Within 30 days of the offboarding, Raymond conducts a short review (15 minutes): did the offboarding complete on time? Were there any credential rotations that were missed? Did the deletion confirmation arrive? Is the engagement file complete? The review is filed at `compliance/third-parties/_archive/<year>/<engagement_id>/post-offboarding-review-<date>.md`. Any finding is added to the next weekly monitoring digest.

## 8. Evidence

The third-party service provider program produces the following evidence, stored in `compliance/third-parties/<engagement_id>/` (active) or `compliance/third-parties/_archive/<year>/<engagement_id>/` (closed):

- **Engagement request** (the Linear / GitHub issue from §4.1).
- **NDA** at `nda-<date>.pdf` (Tier A and B; Tier C optional).
- **Security questionnaire** and Raymond's review at `questionnaire-<date>.{md, pdf}` (Tier A and B).
- **Background check** (Tier A, when the budget permits) or reference check notes (the current compensating control).
- **DPA** at `dpa-<date>.pdf` (Tier A with PII).
- **Contract** at `contract-<date>.pdf`.
- **Access provisioning log** (the `auditLog.ts` entries).
- **Quarterly review** at `review-<year>Q<n>.md` (Tier A).
- **Annual review** at `review-<year>.md` (Tier A and B).
- **Deletion confirmation** at `deletion-<date>.pdf` (on offboarding).
- **Post-offboarding review** at `post-offboarding-review-<date>.md` (on offboarding).
- **Material event reviews** (one per event, named by date).

The inventory of active engagements is the engagement list at `compliance/third-parties/_index.md` (or a CSV equivalent, forthcoming). The list is updated within 5 business days of any engagement change.

The combination is the **SOC 2 CC9.2 + ISO 27001 A.5.19 / A.5.20 / A.5.21 / A.5.23 + ISO 27017 A.5.23 + ISO 27701 6.2.3** audit evidence: a current third-party inventory, proportionate due diligence by tier, documented reviews, and verifiable offboarding.

## 9. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Reviews the security questionnaire for every Tier A and Tier B engagement. Owns the offboarding checklist for the security side. Approves tier classifications. Owns the access provisioning for the security side. |
| **Commercial relationship owner** | **James Carpenter** (default for Tier A) | Owns the commercial relationship. Reviews the contract. Approves the engagement. Signs NDAs and DPAs. Approves offboarding decisions. |
| **Technical relationship owner** | **Cody** (for engagements requiring system access) | Owns the technical integration. Configures the access grant. Verifies the access removal on offboarding. Reports security findings to Raymond. |
| **Management sign-off** | **James Carpenter** | Approves Tier A and Tier B engagements. Approves any offboarding that affects the customer-data path. |

A new Tier A engagement is a Major change under the Change Management Policy (POL-OP-003) and requires James's approval before the NDA is signed. A new Tier B engagement is a Standard change and requires Raymond's review. A new Tier C engagement is a Minor change and requires James's awareness but not a formal review.

## 10. Exceptions

Exceptions to this policy follow the standard exception process in the Information Security Policy (POL-IS-001 §8):

1. **Documented** in a Linear issue tagged `compliance-exception`.
2. **Approved by Raymond** with a stated duration (max 90 days without re-approval).
3. **Disclosed to James** if the exception involves a P0 control, a customer-data path, or a customer commitment.

The most common exception in year 1 is "the background check vendor line item is not yet funded; the compensating control (reference check + attestation) is in place." The exception is time-bounded to the date the budget is expected to be available.

A more serious exception is "we need to grant access before the DPA is signed because of a customer-driven deadline." This exception is allowed only with James's explicit written approval and only when the customer is the one driving the deadline and the data scope is narrowly defined.

## 11. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/04-data-classification-handling.md` — what data is PII, what the data classes are.
- `compliance/policies/05-incident-response.md` — when a third-party incident triggers the IRP.
- `compliance/policies/06-change-management.md` — when a third-party engagement is a Major / Standard / Minor change.
- `compliance/policies/10-vendor-risk-management.md` — the SaaS / infrastructure companion; the sub-processor list at `compliance/vendors.csv` is the public subset of both policies.
- `compliance/policies/11-code-of-conduct.md` — extends to contractors and third parties (POL-HR-011 §2).
- `compliance/policies/12-employee-onboarding-offboarding.md` — the parallel lifecycle for employees.
- `compliance/policies/14-background-check.md` — the background-check policy that this policy references for Tier A.
- `compliance/policies/18-privacy-policy.md` (POL-PRV-001) — the customer-facing privacy notice; §6 covers sub-processor changes that this policy triggers.
- `compliance/CONTROL_MATRIX.md` — CC9.2, A.5.19, A.5.20, A.5.21, A.5.23, 6.2.3 current state and evidence.
- `compliance/vendors.csv` — the public sub-processor list (the SaaS subset of the third-party inventory).
- `compliance/third-parties/_index.md` — the active third-party engagement list.
- `compliance/monitoring/vendor-dpa-pending.md` — the open DPA tracker (this policy's Tier A PII engagements are tracked alongside the SaaS Tier 1 vendors).
- `compliance/templates/nda-template-v1.md` — forthcoming NDA template.
- `compliance/templates/dpa-template-v1.md` — forthcoming DPA template (shared with POL-VEN-001).
- `compliance/templates/security-questionnaire-v1.md` — forthcoming security questionnaire template.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Pairs with POL-VEN-001 (Vendor Risk Management) — this policy covers the people side (contractors, freelancers, consultants, partner companies, IR retainers, design firms, contract engineers); POL-VEN-001 covers the SaaS / infrastructure side. Defines a three-tier classification (Tier A production data / PII, Tier B limited data / non-production, Tier C no data / no systems), a six-step pre-engagement due-diligence flow (request, NDA, questionnaire, background check, DPA, access provisioning), contractual terms (confidentiality, 72h breach notification, 30-day data return, audit rights, insurance), tier-appropriate monitoring (continuous + quarterly Tier A + annual A/B + material event), and the eight-step offboarding checklist. The background check step is the same scope as POL-HR-014 §3; the operational execution is currently the compensating-control variant (reference checks + firm attestation) until the screening-vendor line item is funded. |
