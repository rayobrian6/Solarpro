# Code of Conduct

| Field | Value |
|---|---|
| **Policy** | POL-HR-011 — Code of Conduct |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro employees, contractors, board members, and any party representing Solarpro externally (sales calls, conference talks, customer meetings, social media posts about Solarpro) |

---

## 1. Purpose

This is the policy that says who we are and how we treat people. It's the **SOC 2 CC1.1 / CC1.5 + ISO 27001 A.5.1 / A.5.4** evidence for "commitment to integrity and ethical values" — the auditor's most-asked CC1 question.

If something in this policy prevents you from doing your job, ask first. The cost of a 60-second question is much lower than the cost of a misalignment that's hard to walk back.

## 2. Scope

Applies to everyone representing Solarpro, on or off company time:

- **All employees** (currently: James Carpenter, Raymond O'Brien, Cody).
- **All contractors and freelancers** with access to Solarpro systems or data.
- **All board members and advisors** (when they exist; today the founder/CEO is the only person with that role).
- **All third parties** acting on Solarpro's behalf (sub-processors, agency partners, contracted engineering firms, contracted incident-response firms).

## 3. Mission and values

**Mission.** Solarpro turns rooftop measurement photos and survey data into permit-grade plan-sets and bills of materials for residential solar installers. We exist to make the engineering correct, the paperwork faster, and the homeowner experience dignified.

**Values.** Five. They are not aspirational — they are the rule we hold ourselves to when a decision is otherwise 50/50.

1. **Correctness over speed.** A wrong plan-set costs a permit rejection. A wrong bill of materials costs the installer money. We would rather ship a day late than ship a thing wrong. This is also why the engineering pipeline has so many gates.
2. **Privacy by default.** Customer photos include the homeowner's address, sometimes the homeowner's face, sometimes the homeowner's car with the license plate visible. We treat that data like it was our own. The Data Classification & Handling Policy is the operational rule; this value is why we wrote it.
3. **Honest about gaps.** A 3-person team has gaps. We name them. The control matrix at `compliance/CONTROL_MATRIX.md` lists 78 controls; some are Implemented, some are Partial, some are Gap. The Partial and Gap rows are not hidden from the auditor and are not hidden from customers when they ask.
4. **Boring infrastructure, auditable choices.** We use Vercel, Neon, Render, GitHub, Stripe, Cloudflare, Sentry. The reasons are written down (ADR-001 through ADR-007 in `docs/`). We are not running anything exotic, and the choice history is reproducible.
5. **One team, no internal politics.** A three-person team cannot afford internal politics. When we disagree, we say so out loud, decide, and move on. Decisions are recorded; if the decision turns out wrong, we change it without blaming the person.

## 4. Expected behavior

The following are baseline expectations. They are not exhaustive — they are the floor, not the ceiling.

### 4.1 To each other

- Treat colleagues, contractors, and customer-team members with the same respect you'd want for yourself.
- No harassment of any kind. No discrimination based on race, gender, sexual orientation, religion, age, disability, veteran status, or any other protected category.
- Disagree directly and respectfully. Don't make it personal. Don't make it a side channel.
- Don't write things in Slack that you wouldn't say in front of the person. We are a small team; tone carries.

### 4.2 To customers and end users

- The homeowner in the photo is a person. They didn't choose to be in the survey intake. The plan-set we generate is signed by an installer who put their license on it. Both deserve our best work.
- Customer data is for the customer's project. It is not for training an unrelated model. It is not for a sales pitch to a different customer. It is not for a blog post screenshot. See the Data Classification & Handling Policy §4.
- When we make a mistake that affects a customer, we say so. We say what happened, what we're doing about it, and what the customer can do. We do not hide.

### 4.3 To vendors and partners

- Pay invoices on time. The 30-day payment term in our vendor contracts is the floor; we aim for 15.
- Don't share one vendor's pricing with another.
- When we end a vendor relationship, we follow the offboarding checklist in the Vendor Risk Management Policy §7 — credentials rotated, data returned or deleted, access revoked.

### 4.4 To the public

- Anything we publish (blog, marketing site, social media, conference talk) is reviewed for claims we can substantiate. Marketing copy that overstates capability is a brand problem and a compliance problem.
- AI-generated content is labeled as such when it could be mistaken for first-party thought leadership.
- Security disclosures (vulnerabilities, incidents) follow the Incident Response Plan. We don't tweet about a Sev1 before the customer is notified.

## 5. Conflict of interest

A conflict of interest exists when a personal interest could influence (or appear to influence) a decision made on Solarpro's behalf. The default is to disclose, not to avoid.

**Annual disclosure.** Once a year (by the policy review date, 2027-08-15 for the first cycle), every team member completes a one-page Conflict of Interest Disclosure. The form asks:

- Outside employment, consulting, or board roles.
- Financial interests in vendors, customers, or competitors of Solarpro (>$5,000 holding or option grant).
- Family or close personal relationships with anyone at a Solarpro vendor, customer, or competitor.
- Any transaction or arrangement that could be perceived as a conflict.

The completed forms are stored at `compliance/disclosures/`. Raymond reviews; James signs off on any disclosure that requires a mitigation (recusal, divestment, contract change, or termination of the outside relationship).

**Examples of things to disclose (not exhaustive):**

- A spouse works at a vendor we are evaluating.
- A side project uses the same ML vision API we use, and the founder is the same person.
- A friend is a solar installer who could be a customer.
- A previous employer offers a contract engagement.

**Examples of things that are not conflicts (don't disclose):**

- Owning a diversified index fund that happens to hold Solarpro competitors.
- Being friends with someone at a customer, with no business relationship.
- Attending a conference hosted by a vendor.

The list above is illustrative. When in doubt, disclose. The disclosure is the protection, not the disclosure form itself.

## 6. Anti-bribery and anti-corruption

Solarpro is a US-incorporated company operating in US jurisdictions. We comply with the **US Foreign Corrupt Practices Act (FCPA)** for any international engagement and with state-level anti-bribery laws for domestic. The policy is short because the rule is short:

- **No bribes.** No payments, gifts, favors, or anything of value to anyone (government official, customer decision-maker, vendor salesperson, inspector) to influence a business decision. Ever.
- **No kickbacks.** No payments from a vendor back to a Solarpro employee in connection with a vendor selection.
- **No facilitation payments.** "Facilitation payments" to expedite a routine government action are bribes under the FCPA, full stop. The fact that they are common in some jurisdictions does not make them legal or permitted.
- **Gifts and hospitality are limited.** Gifts to or from current or prospective customers, vendors, or government officials must be (a) modest in value, (b) not cash or cash-equivalent, (c) not given in a way that could appear to influence a decision, and (d) logged in `compliance/gifts-log/` when over $50 in value. The log is reviewed quarterly by Raymond.
- **Charitable and political contributions** are made by the company (if at all), not by individual employees representing themselves as Solarpro. Personal political activity is personal.

**Reporting.** Suspected bribery, attempted bribery, or requests for bribes are reported through the channels in §9. The reporter is protected under §10.

**No commercial rationale exception.** There is no business case that overrides this section. A deal lost to a competitor who bribed is a deal we were not going to win on terms we'd want to live with.

## 7. Confidentiality and intellectual property

- **Customer and project data** is confidential to the customer and to Solarpro for the purpose of serving the customer. It is not used for any other purpose. See Data Classification & Handling Policy §2-3.
- **Solarpro source code, designs, and internal documents** are confidential to Solarpro. The Acceptable Use Policy §3-5 covers the daily rule; this section covers the principle.
- **Third-party confidential information** (vendor pricing, partner roadmaps, customer architectures we are invited to review) is held in confidence per the NDA we signed to receive it.
- **Inventions, code, and content** created by an employee or contractor in the course of their work for Solarpro, on company time or using company resources, is the property of Solarpro. The IP assignment is in the standard employment / contractor agreement template; onboarding (Policy 12) confirms the agreement is signed before access is granted.
- **Pre-existing IP** an employee brings in (a personal project, a prior employer's work) is disclosed during onboarding and excluded from the IP assignment scope. The exclusion is recorded in the employee's personnel file.

## 8. Compliance with laws and regulations

Solarpro operates in compliance with applicable laws. The list is not exhaustive, but the items most likely to apply to a 3-person solar software company:

- **US export controls** (EAR, OFAC sanctions) for any international data transfer.
- **State privacy laws** (CCPA/CPRA in California, similar in Colorado, Connecticut, Virginia, and others as they come into effect).
- **GDPR** for any EU resident data subject.
- **SOC 2, ISO 27001, ISO 27701, ISO 27017** as committed in the Information Security Policy §6.
- **AHJ and utility requirements** as embedded in the engineering pipeline (permit-snapshot digest, AHJ registry, equipment registry).
- **PCI DSS** is delegated to Stripe (PCI DSS Level 1); we do not store or process cardholder data (Data Classification & Handling Policy §2.4).

When a law changes, or when Solarpro expands into a new jurisdiction, the relevant policy is updated within 60 days. The control matrix is updated in the same PR.

## 9. Reporting violations

The right thing to do when you see a problem is to say so. The channels, in order of speed:

1. **Raymond directly** (Slack DM, email, or phone) for anything time-sensitive or security-adjacent.
2. **James directly** if Raymond is the subject of the concern, or if Raymond is unreachable for more than an hour on a Sev1-class issue.
3. **`conduct@solarpro.app`** (a monitored alias that routes to both Raymond and James) for HR-adjacent concerns, conflict-of-interest issues, or anonymous reports.
4. **Anonymously, in writing**, mailed to the registered agent (the address on file with the Illinois Secretary of State) marked "Personal and Confidential — To Be Opened by Raymond O'Brien and James Carpenter Only." Anonymous reports are investigated to the extent the information allows.

**No retaliation.** The next section is on this, and it is the most-asserted paragraph in the policy. We will not retaliate against a person who reports a concern in good faith, even if the concern turns out to be unfounded. The "in good faith" part matters: a report made to harm someone, or to gain leverage in a personal dispute, is not protected.

**No quota on complaints.** Reporting a concern is not a productivity tax. The expectation is that a 3-person team raises issues early and often. A team where nothing is ever reported is a team where things are being hidden.

**Acknowledgment.** Every report is acknowledged within 24 hours (1 business day for non-urgent). The acknowledgment names the person who will investigate and the expected timeline for a substantive response. If the substantive response takes longer than 14 days, the reporter gets a status update every 14 days until resolution.

## 10. No retaliation

This is the most-asserted paragraph in the entire policy library.

**Retaliation against a person for reporting a concern in good faith, for participating in an investigation, or for exercising a right under any Solarpro policy, is itself a violation of this policy and grounds for immediate termination.**

Retaliation includes but is not limited to: termination, demotion, reduction in responsibilities, exclusion from meetings, change in work assignment, change in compensation, negative performance review language, or any conduct that a reasonable person would consider likely to deter a person from reporting.

The retaliation investigation is run by the person who is **not** the subject of the original report. If James is the subject, the investigation is run by an outside investigator (engaged per the Vendor Risk Management Policy §5 process).

## 11. Disciplinary process

A violation of this policy is handled by the following process. The process is not a script; it is the default, and the response is scaled to the violation.

| Class | Examples | Process | Outcome |
|---|---|---|---|
| **Coaching** (low-impact, no customer harm, no malicious intent) | One-time use of an unauthorized tool that touches no customer data. Late on a routine disclosure. | Raymond talks to the person. The conversation is documented in the personnel file. | Coaching note. No restriction. |
| **Formal warning** (repeat, willful, or low-impact-with-customer-touch) | Bypassing MFA "for testing" and leaving it disabled. Sharing a credential in a Slack DM. | Raymond documents the warning, James signs off, the warning is filed in the personnel file. | Formal warning on file. 12 months until eligible for removal from the file. |
| **Access suspension + HR review** (mid-impact, or any violation with customer data exposure) | Sending customer PII to a personal AI tool. Storing production data on a personal device. | Access suspended within 1 hour. James leads the review. Raymond documents. | Suspension, possible termination depending on review outcome. |
| **Termination + legal review** (willful, malicious, or regulatory-reportable) | Exfiltration of customer data. Bribery. Harassment. Retaliation. | Immediate termination. Legal counsel engaged. Law enforcement contacted if appropriate. Regulatory notifications (GDPR 72h, state breach laws) per the Incident Response Plan §5.5. | Termination. Civil and/or criminal referral. |

**Appeal.** A person subject to a formal warning or termination may appeal in writing to the person who was not the decision-maker (if the decision was Raymond's, appeal to James; if the decision was James's, appeal to outside counsel). The appeal must be filed within 14 days. The appeal decision is final.

## 12. Annual acknowledgment

Every team member, contractor with access, and board member (when one exists) acknowledges this policy **once per year**. The acknowledgment is:

- Read the policy (or re-read it).
- Confirm understanding of: the values in §3, the conflict of interest disclosure in §5, the anti-bribery rule in §6, the reporting channels in §9, and the no-retaliation rule in §10.
- Complete or update the conflict-of-interest disclosure form (annual cycle aligned with the policy review date).
- Sign (electronic or wet) the acknowledgment.

The acknowledgments are stored at `compliance/acknowledgments/code-of-conduct/<year>/<name>.pdf`. Missing acknowledgments are reported to Raymond in the monthly compliance digest and are a blocker on continued access for the next 30 days after the due date. The first cycle is due by **2027-08-15**.

**New team members** acknowledge this policy as part of onboarding, before access is granted (see the Employee Onboarding & Offboarding Policy §3).

## 13. Related documents

- `compliance/policies/01-information-security.md` — foundation policy.
- `compliance/policies/02-acceptable-use.md` — daily system and data usage rules.
- `compliance/policies/03-access-control.md` — provisioning, deprovisioning, the 24h rule.
- `compliance/policies/05-incident-response.md` — what to do when something goes wrong.
- `compliance/policies/12-employee-onboarding-offboarding.md` — the lifecycle that surrounds this policy.
- `compliance/CONTROL_MATRIX.md` — CC1.1, CC1.5, A.5.1, A.5.4 evidence row.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Drafted alongside the Employee Onboarding & Offboarding Policy and the rest of the Personnel cluster (Sprint 2, batch 3). |
