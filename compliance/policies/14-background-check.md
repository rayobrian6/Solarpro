# Background Check Policy

| Field | Value |
|---|---|
| **Policy** | POL-HR-014 — Background Check Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro new hires, contractors with PII or production access, and board members |

---

## 1. Purpose

This policy defines the background-screening process for everyone who joins Solarpro in a capacity that involves access to customer data, production systems, financial information, or confidential business information. It's the **ISO 27001 A.6.1 + A.6.2** evidence for "screening" and "terms and conditions of employment."

The policy is in two parts:

- **§2 - §6**: the intended process — the rules we operate against when the budget is available. This is the policy the auditor reads.
- **§7**: the **deferred execution** — a clear, honest description of what is and is not happening today (2026-08-15), why, and when the policy is expected to become fully operational.

The principle: a policy with a documented deferral is stronger evidence than a policy that hides its gaps. An auditor who sees the deferral, the rationale, the interim compensating control, and the re-evaluation date is looking at a working control environment. An auditor who sees a claimed background check that doesn't exist is not.

## 2. Scope

The following roles require a background check before access is granted:

| Role class | Examples at Solarpro today | Background check required? |
|---|---|---|
| **Full-time employee** | James, Raymond, Cody | Yes (when budget permits; see §7) |
| **Part-time employee** | None today | Yes |
| **Contractor with PII access** | Engineering contractors, design contractors | Yes (when budget permits; see §7) |
| **Contractor with production access** | DevOps contractors, on-call contractors | Yes (when budget permits; see §7) |
| **Contractor with no PII or production access** | Marketing copywriter, graphic designer | No — the access scope does not require it |
| **Board members and advisors** | None today (James is the founder/CEO) | Yes (when one is added) |
| **Interns** | None today | Yes if the internship involves PII or production access; no otherwise |
| **Family members of employees** | Not hired today | Not eligible for hire while the family member is employed (conflict of interest; see Code of Conduct §5) |

The "contractor with no PII or production access" exclusion is the one place the policy allows access without a background check. A copywriter who writes blog posts in Google Docs does not see customer data. A designer who works on the marketing site does not see production systems. The classification is made by James in writing (Linear issue) before the engagement begins.

## 3. The check components

When the policy is fully operational (§7), every check consists of the following components. The vendor (TBD) runs the check; Raymond reviews the result; James signs off on the hire.

### 3.1 Identity verification

Confirmation that the identity documents presented during the I-9 process are authentic and that the person presenting them is the person named. The check uses:

- Government-issued photo ID (driver's license, passport, state ID).
- Social Security number trace (US) or equivalent national ID trace (non-US).
- Address history trace (the last 7 years).

This is the **A.6.1 (screening)** baseline. The I-9 / identity verification step in the Employee Onboarding & Offboarding Policy §3.2 is the operational execution of this check today; the background check vendor will independently verify when the policy is fully operational.

### 3.2 Criminal background check

A county-, state-, and federal-level criminal records search for the last 7 years. The check covers:

- Felony convictions.
- Misdemeanor convictions (excluding minor traffic offenses).
- Active warrants.
- Sex offender registry (US).
- Global sanctions lists (OFAC, EU, UN).

The disqualifying offenses are:

- Any felony conviction for a crime involving dishonesty (fraud, theft, embezzlement, bribery).
- Any felony conviction for a violent crime.
- Any conviction for a computer crime (CFAA, equivalent state law, or international equivalent) within the last 10 years.
- Any active warrant.
- Any match on a global sanctions list.

A non-disqualifying criminal record (e.g. an old misdemeanor for a non-relevant offense) is reviewed case-by-case by James with a written rationale for hire or decline. The candidate is informed of the record before the decision and is given the opportunity to provide context.

### 3.3 Employment history

Verification of the last 7 years of employment, including:

- Employer name and address.
- Position title.
- Start and end dates.
- Reason for leaving.
- Eligibility for rehire (the vendor asks the prior employer).

The check is performed by the vendor. False claims on a resume (a fabricated employer, an inflated title) are reviewed case-by-case. A fabricated employer is a decline; an inflated title with a verifiable role underneath is a coaching conversation.

### 3.4 Education verification

Verification of the highest degree claimed on the resume. The check confirms:

- Institution name.
- Degree awarded.
- Year of award.
- Major / field of study (where applicable).

A non-verifiable degree (the institution has no record) is reviewed case-by-case. A non-verifiable degree from an unaccredited institution is not a decline if the role does not require the credential; a non-verifiable degree from an accredited institution where the candidate claimed accreditation is a decline.

### 3.5 Reference checks

The vendor collects **3 professional references** from the candidate's last 7 years of employment. The references are contacted by phone (not email) and asked:

- How long have you known the candidate, and in what capacity?
- What were the candidate's responsibilities?
- What were the candidate's strengths and areas for improvement?
- Would you hire the candidate again?
- Is there anything we should know that the candidate might not have shared?

A reference who refuses to provide substantive information is noted. A pattern of refusals across all three references is a signal for further conversation with the candidate.

### 3.6 Credit check (US only, where permitted)

For roles with financial responsibility (e.g. any role that signs contracts, holds a company credit card, or has authority to initiate payments), a credit check is run. The check is governed by the **Fair Credit Reporting Act (FCRA)**:

- Written disclosure to the candidate before the check.
- Written authorization from the candidate.
- A copy of the report and a written summary of rights provided to the candidate if the report is used adversely.
- A pre-adverse-action period (5 business days) before the final decision.

A poor credit report is not by itself a decline. The credit report is reviewed in context (recent medical debt, student loans, a one-time life event) and the candidate is given the opportunity to explain.

Credit checks are **not** run for roles without financial responsibility, and are **not** run for candidates in jurisdictions that prohibit employment-related credit checks (Illinois, California, New York, and others).

## 4. Vendor

### 4.1 Vendor selection (deferred)

The vendor is **TBD**. The candidates are:

- **Checkr** — modern, API-first, fast turnaround (typically 1-3 days for most checks), popular with venture-backed startups. Pricing is per-check, with a SaaS-style dashboard.
- **Sterling** — incumbent, broader service catalog (including international checks), higher price, slower turnaround. Popular with larger enterprises and regulated industries.

Selection criteria:

- **Coverage**: US + international (we may hire outside the US in 2027+).
- **Turnaround**: ≤5 business days for a standard check.
- **API**: programmatic check ordering and result retrieval (so the result lands in the personnel file automatically, not via a PDF email).
- **FCRA compliance**: written compliance program, audit history clean.
- **SOC 2 Type 2 report on file**.
- **Pricing**: per-check, not per-seat; volume discount at >50 checks/year.

The selection is deferred until the budget supports the recurring cost (estimated $50-150 per check depending on components, plus a SaaS fee). The decision is made by James with input from Raymond and is documented as a vendor entry in `compliance/vendors.csv`.

### 4.2 Vendor management

Once selected, the background check vendor is managed per the Vendor Risk Management Policy §5. The vendor is classified as **Tier 2** (handles PII-adjacent data — name, SSN trace, employment history — but not customer PII). A DPA is required before the vendor receives any candidate data. The vendor's SOC 2 Type 2 report is collected annually.

## 5. Annual re-check

Employees in the following privileged roles are re-checked **annually**:

| Role | Why re-checked | Components re-run |
|---|---|---|
| **CISO (super_admin)** | Highest privilege; access to all systems | Criminal background, sanctions list |
| **CEO / Management sign-off** | Authority to commit the company | Criminal background, sanctions list |
| **Anyone with Neon production write access** | Direct DB access | Criminal background, sanctions list |
| **Anyone with Stripe admin access** | Payment authority | Criminal background, sanctions list, credit check |
| **Anyone with Cloudflare DNS edit access** | Can redirect traffic | Criminal background, sanctions list |

For a 3-person team today, this covers James, Raymond, and Cody — all three are re-checked annually when the policy is fully operational. The first annual re-check is due **2027-08-15**.

A change in the re-check result (e.g. a new criminal record, a sanctions-list match) is handled per §6.

## 6. Adverse results and disputes

### 6.1 Decline on adverse result

If a background check returns a result that would have been a decline at hire:

- The candidate is informed in writing within 5 business days of the result.
- A copy of the report is provided (FCRA requirement).
- A pre-adverse-action notice is sent (5 business days before the final decision).
- The candidate may dispute the result directly with the vendor. The vendor investigates and re-issues the report.
- If the dispute is resolved in the candidate's favor, the offer is reinstated (or the employee continues in role, for annual re-checks).
- If the dispute is unresolved and the adverse result stands, the offer is rescinded (or the employee is terminated for cause per the Code of Conduct §11).

The decision and the rationale are documented in the personnel file. The decision is reviewed by James with input from Raymond and, for FCRA-covered checks, the company's employment counsel.

### 6.2 Re-check reveals a new disqualifying event

For an annual re-check, a new disqualifying event (a recent criminal conviction, a sanctions-list match) is reviewed immediately. The review determines:

- The nature of the event.
- The time elapsed.
- The relevance to the employee's role.
- The remediation options (continued employment with monitoring, role change, demotion, termination).

The review is conducted by James with input from Raymond and, for serious matters, outside counsel. The outcome is documented in the personnel file. The default is that a new disqualifying event results in a role change to remove the access that the disqualifying event makes inappropriate (e.g. a credit-card fraud conviction results in removal of Stripe admin access). Termination is reserved for the most serious cases.

## 7. Deferred execution — current state (2026-08-15)

This section is the honest, on-the-record description of where the policy is and is not being executed today. The auditor should read this section as evidence of a working control environment, not as an attempt to hide a gap.

### 7.1 What is NOT happening today

- **The vendor is not selected.** Checkr vs Sterling is a decision the budget does not yet support. The recurring cost (estimated $1,500-5,000/year at 3-5 hires/year) is not in the 2026 operating budget.
- **The full background check is not being run.** No candidate is paying for or waiting on a vendor check.
- **The annual re-check is not being run.** The 3-person team (James, Raymond, Cody) has not been re-checked.
- **The components in §3 (criminal, employment, education, references, credit) are not being verified by an independent vendor.**

### 7.2 What IS happening today (the compensating controls)

The interim measures that operate in place of a vendor check:

1. **Identity verification** (Employee Onboarding & Offboarding Policy §3.2) is in effect. The I-9 / government-issued ID review is performed for every hire, including the 3 current team members. This is the A.6.1 baseline.
2. **Reference checks are informal.** Raymond or James calls the references named by the candidate. The call is documented in the personnel file (a memo, not a vendor report). The reference check is the same conversation a vendor would have, but it's not an independent verification.
3. **The PIIAA / NDA / Code of Conduct** are signed by every team member and contractor with access (Employee Onboarding & Offboarding Policy §3.3). The legal liability that the background check would surface is mitigated by the contractual liability the PIIAA creates.
4. **The 3-person team is known.** James hired Raymond and Cody; both were known professionally before hire. The "would I trust this person with customer data" judgment was made on personal knowledge, not on a vendor report. This is not a scalable compensating control and is not a substitute for a vendor check; it is what we have today.
5. **The conflict of interest disclosure** (Code of Conduct §5) is completed annually. Conflicts that would be a background-check concern (e.g. undisclosed financial interests in a vendor) are surfaced in the disclosure.
6. **The user access review** (Access Control Policy §3.4) is run quarterly. Any anomalous access pattern is a signal that the team member's circumstances have changed in a way that warrants review.

### 7.3 The rationale for the deferral

The decision to defer the full background check until the budget permits is a James decision, made on 2026-07-30 in the context of the SOC 2 Type 1 readiness review:

> "We do not have the operating budget to commit to a recurring background-check vendor at this time. The identity verification (I-9), the reference calls, and the PIIAA together are the interim compensating controls. The background check policy is drafted and will be triggered as soon as the budget comes back."

The decision is recorded in the Notes from the 2026-07-30 SOC 2 readiness review (the "no-money decision" referenced in the sprint planning).

### 7.4 The re-evaluation trigger

The deferral is re-evaluated when any of the following is true:

- The operating budget supports a recurring background-check vendor cost (estimated trigger: ~$10,000/month operating cash buffer).
- The team grows beyond 5 people (a larger team dilutes the "I know them personally" compensating control).
- A new jurisdiction or customer contract requires a formal background check.
- A security incident or near-miss suggests the compensating controls are insufficient.
- The SOC 2 auditor or ISO 27001 auditor flags the deferral as unacceptable in a finding.

The re-evaluation is documented in `compliance/CONTROL_MATRIX.md` as a status change for the A.6.1 / A.6.2 controls from "Partial (deferred)" to "Partial (vendor selected)" to "Implemented (operational)."

### 7.5 The auditor's view

An auditor reading this section sees:

1. The policy exists (the "we have a policy" question is answered).
2. The deferral is documented and explained (the "are you hiding this" question is answered).
3. The interim compensating controls are described (the "what are you doing instead" question is answered).
4. The re-evaluation trigger is named (the "when does this get fixed" question is answered).
5. The decision-maker is named (the "who decided" question is answered).

This is the SOC 2 / ISO 27001 evidence. The deferral is not a control failure; the failure would be to claim a background check is happening when it is not, or to be silent about the gap.

## 8. Records and retention

Background check records (when the policy is fully operational) are stored per the data retention rules in the Data Classification & Handling Policy §6.1:

- **Successful check results**: 7 years post-employment (matches personnel file retention).
- **Adverse results that did not result in hire**: 2 years post-decision (matches FCRA guidance for non-hires).
- **Annual re-check results**: 7 years post-check.
- **Disputes and their resolution**: 7 years post-resolution.

Records are stored in the personnel file in Google Drive with restricted access (James and Raymond only, by default). Records are **redacted** before being shared outside the personnel file (e.g. for an audit) — the SSN trace, the full credit report, and the criminal case numbers are redacted. The redaction is documented in the audit log.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation policy.
- `compliance/policies/03-access-control.md` — provisioning that the background check gates.
- `compliance/policies/11-code-of-conduct.md` — conflict of interest, the disciplinary process.
- `compliance/policies/12-employee-onboarding-offboarding.md` — the I-9 / identity verification step, the lifecycle that surrounds this policy.
- `compliance/policies/15-password-authentication.md` — the access the background check gates.
- `compliance/vendors.csv` — the background check vendor entry when selected.
- `compliance/CONTROL_MATRIX.md` — A.6.1, A.6.2 evidence rows.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Drafted with explicit "Deferred execution" §7 to document the no-money decision and the interim compensating controls. The policy is the rule; the deferral is the operational reality. |
