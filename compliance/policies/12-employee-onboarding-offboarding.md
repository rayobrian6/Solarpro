# Employee Onboarding & Offboarding Policy

| Field | Value |
|---|---|
| **Policy** | POL-HR-012 — Employee Onboarding & Offboarding Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro employees and contractors, from offer letter through the last day of access, including the 24-hour post-termination access revocation requirement |

---

## 1. Purpose

This policy is the operational lifecycle that surrounds the Access Control Policy. Where the Access Control Policy says "access is granted by Raymond or Cody after James approves the hire," this policy says **what that looks like step by step** — the documents, the accounts, the training, the equipment, the day-one checklist, and the offboarding mirror that ends with all access revoked within 24 hours of termination.

It's the **SOC 2 CC6.2 / CC6.3 + ISO 27001 A.6.1 / A.6.2 / A.6.3 / A.6.5** evidence. The 24-hour revocation rule in §6 is a **SOC 2 hard requirement** — auditors will test it.

The 3-person team is the proof case. James, Raymond, and Cody each went through this process in some form (or are still going through it, in James's case as the first employee of his own company). The procedures are sized to a startup that may grow to 5-10 people in the next 12 months, and they are designed to scale linearly without re-architecting.

## 2. Roles

| Role | Person | Onboarding/offboarding responsibility |
|---|---|---|
| **Founder / CEO / Management sign-off** | **James Carpenter** | Approves every hire, every offer letter, every compensation change, and every termination. Signs the offer letter, the IP assignment, and the exit paperwork. |
| **CISO / Security point** | **Raymond O'Brien** | Owns the security side of the lifecycle. Creates the security accounts (Google Workspace, GitHub, Vercel, Render, Neon, Sentry, 1Password), grants the platform role in the app, and runs the security training. Conducts the exit interview from a security standpoint. |
| **Technical lead** | **Cody** | Provisions the developer-side accounts (GitHub org membership, Vercel team membership, Render access, Neon DB role), sets up the dev environment, and runs the technical onboarding (codebase tour, dev workflow, on-call shadow). Receives the equipment return on offboarding. |

For contractors and part-time engagements, the same roles apply, scaled to the engagement length. A 2-week contractor goes through a compressed version (no 90-day check-in; access expires on the contract end date).

## 3. Pre-employment (offer letter to day 0)

### 3.1 Offer letter and approval

Before any background check, NDA, or system access:

1. **James drafts or approves the offer** in writing. The offer includes: title, start date, compensation, at-will employment statement (US default), reporting structure, and the equipment commitment (laptop, monitor, peripheral budget).
2. **Compensation changes** are also approved by James in writing (Slack, email, or Linear issue). Verbal "we'll figure it out" is not a compensation commitment.
3. **For contractors**: a statement of work (SOW) replaces the offer letter. The SOW names the scope, the deliverables, the rate, the payment terms, and the end date. The SOW is signed before any system access.

### 3.2 Identity verification

For employees, the **I-9 Employment Eligibility Verification** (USCIS Form I-9) is completed on or before the start date. The identity and work-authorization documents are inspected in person (or via an authorized remote service for fully-remote hires). The I-9 is retained per USCIS rules (3 years after hire or 1 year after termination, whichever is later).

For contractors, identity is verified by reviewing a government-issued photo ID (driver's license or passport). A copy is stored in the personnel file with the contract.

This satisfies **A.6.1 (screening)** at the identity-verification level. The Background Check Policy (POL-HR-014) covers the deeper screening that is **deferred** until budget is available (see §3.4).

### 3.3 NDA, confidentiality, and IP assignment

Before day 1 access:

1. **Mutual NDA** signed (Solarpro's standard template, or a counter-party's reasonable equivalent that Raymond has reviewed).
2. **Proprietary Information and Inventions Assignment Agreement (PIIAA)** signed. The PIIAA covers:
   - Confidentiality of Solarpro information.
   - Assignment of work-for-hire inventions to Solarpro.
   - Disclosure of pre-existing IP that the employee brings in (which is carved out of the assignment).
   - Non-solicitation of Solarpro employees and customers for 12 months post-termination.
3. **Code of Conduct acknowledgment** signed (POL-HR-011 §12). The acknowledgment is stored at `compliance/acknowledgments/code-of-conduct/<year>/<name>.pdf`.
4. **Acceptable Use Policy acknowledgment** signed (POL-IS-002). Same storage location pattern.

The signed documents are stored in the personnel folder (Google Drive, `Personnel/<Name>/Signed/`). The signed PIIAA and the conflict-of-interest disclosure are also referenced in the personnel file index.

### 3.4 Background check — deferred execution

The background check process is documented in **POL-HR-014 (Background Check Policy)**, which exists in this policy library. The full check (identity, criminal, employment history, education, references, credit where applicable) is **deferred until operating budget permits** — the vendor cost is a recurring line item, not currently affordable. The current state (2026-08-15) is:

- Policy: **drafted, awaiting signature** (POL-HR-014).
- Vendor: **TBD** (Checkr or Sterling are the likely candidates; selection deferred).
- Identity verification (I-9 / government ID review): **in effect** — this is the §3.2 step above and is not deferred.
- Reference checks: **informal** — Raymond or James calls the references named by the candidate and documents the call. Not a substitute for a formal background check; an interim measure.

The deferral is documented honestly. An auditor seeing the deferred-execution note is better evidence of a working control environment than an auditor seeing a claimed background check that doesn't exist.

### 3.5 Day 0 — equipment and access

For an in-office or hybrid hire:

- **Laptop**: MacBook Pro (default) or Linux workstation (Cody's preference). The laptop is shipped to the hire's address with the standard image (managed via 1Password device catalog, not via MDM today — see the open gap in the Acceptable Use Policy §6).
- **Monitor / peripherals**: shipped or purchased locally per the offer-letter equipment commitment. Receipts are reimbursed up to the equipment budget.
- **Phone**: not issued today. The hire uses their personal phone with a Google Voice number for Solarpro calls, or the Acceptable Use Policy §6 BYOD rules apply.

For a fully-remote hire, the equipment ships to the verified address. The address is confirmed against the I-9 / government ID record before the package ships.

## 4. Day 1 — first session

Day 1 is the day the hire gets a user account. The first session must require a password reset and MFA enrollment. The hire cannot use any account productively until both are done.

### 4.1 Account provisioning

The day-1 access package, scoped to the hire's role:

| Account | Provisioned by | Day 1 access | Notes |
|---|---|---|---|
| Google Workspace | Raymond | Yes | First session forces password reset + MFA enrollment. |
| GitHub (org member) | Raymond | Yes | Added to `@solarpro` org with role appropriate to the hire (member for engineers; outside collaborator for designers/contractors). |
| 1Password | Raymond | Yes | Invite to the Solarpro team vault. The hire's personal 1Password is unaffected. |
| Slack | Raymond | Yes | Single workspace; channels are added as relevant. |
| Linear | Raymond | Yes | Read access to the workspace; write access to the team's projects. |
| Vercel (team member) | Cody | For engineers | Read access to projects; deploy access granted by role. |
| Render (team member) | Cody | For engineers | Read access; deploy access granted by role. |
| Neon (DB role) | Cody | For engineers | `app_writer` role for full-stack engineers; `compliance_ro` for read-only. |
| Sentry (project member) | Cody | For engineers | Read access; alerting wiring added in week 1. |
| App (Solarpro) | Raymond | Yes | `user` platform role by default. Org role granted by the hiring manager. |
| Cloudflare | Raymond | For engineers | Per-role (DNS read for most; DNS edit for Raymond and James). |
| Stripe | James | For finance roles only | Not provisioned for engineers. |
| Resend | James | For engineering leads | Per-role. |

The hire's first session in any of these systems forces a password reset and MFA enrollment. The hire cannot use the account productively until both are done. (Access Control Policy §3.1.)

### 4.2 Day 1 checklist

The day-1 checklist is a Linear issue template titled `<Name> — Day 1 Onboarding`, owned by Raymond, with the following sub-tasks:

- [ ] Hire signs the offer letter (or SOW for contractors) — stored in `Personnel/<Name>/Signed/`.
- [ ] I-9 / identity verification completed (USCIS e-Verify for US citizens; manual review for non-citizens).
- [ ] NDA, PIIAA, Code of Conduct, AUP, and Data Classification & Handling Policy acknowledgments signed.
- [ ] Conflict of Interest Disclosure form completed (annual cycle starts here; form is in `compliance/disclosures/`).
- [ ] Equipment shipped or hand-delivered.
- [ ] Google Workspace account created. First login completes password reset and MFA enrollment.
- [ ] 1Password invite accepted. Hire is added to the relevant vaults.
- [ ] GitHub org membership added. Hire has a personal GitHub account and a Solarpro 2FA device.
- [ ] Linear account created. Hire joins the team's projects.
- [ ] Slack account created. Hire joins `#general`, `#announcements`, the team channel, and the role-specific channel.
- [ ] App account created. Hire is added to the relevant organization(s) with the role the hiring manager specified.
- [ ] 2-hour Security Primer completed (Security Awareness & Training Policy §4).
- [ ] Pair with the onboarding buddy (assigned in the offer letter) for a 60-minute codebase / workflow walkthrough.

The completed checklist is closed by Raymond on day 1. Any blockers are escalated to James the same day.

### 4.3 First-week deliverables

By the end of the first week, the hire has:

- Shipped a "hello world" pull request (engineers) or produced a first deliverable (other roles) — proof that the toolchain works end-to-end.
- Completed the role-specific security training (engineers: secure coding primer; finance: payment-handling; everyone: PII handling for the role). See the Security Awareness & Training Policy §5.
- Met with each team member for 30 minutes (a 3-person team = 90 minutes total).
- Reviewed and asked questions on the Information Security Policy, the Access Control Policy, the Data Classification & Handling Policy, the Incident Response Plan, and the Code of Conduct.

## 5. Ongoing — the steady state

### 5.1 Quarterly policy review

Every quarter, on the 1st business day of January, April, July, and October, the team holds a **30-minute policy review huddle**. The agenda is:

- One policy is reviewed in depth (5 minutes: changes, clarifications, exceptions in the prior quarter).
- Three "what changed in the last 90 days" items (Sentry alerts, UAR findings, vendor changes).
- One "what's coming in the next 90 days" item (upcoming framework additions, upcoming vendor changes, upcoming audits).
- Open questions / anonymous submission via `conduct@solarpro.app`.

The huddle is run by Raymond. The notes are stored at `compliance/policy-reviews/<YYYY-Q#>.md`. Missing the huddle without prior notice is logged but is not itself a violation; missing three in a row is a coaching conversation.

### 5.2 Role changes

A role change is treated as a **deprovisioning of the old access + provisioning of the new access** in the same operation. Net access never goes up during a role change unless James has approved it in writing. The Access Control Policy §3.2 covers the mechanics; this policy requires:

1. James approves the role change in writing.
2. Raymond closes the old access and grants the new access in the same Linear issue.
3. The hire re-authenticates within 5 minutes or their session is invalidated.
4. The `auditLog.ts` event records the actor, target, before/after, and reason.

A role change that crosses the "employee → contractor" or "contractor → employee" line is treated as a full offboarding + onboarding, not a role change. The PIIAA, NDA, and tax forms all change.

### 5.3 Security training refresh

The Security Awareness & Training Policy §5 defines the required cadence. The summary:

- Security awareness training: **annual**.
- Secure coding training (engineers only): **annual**.
- Phishing simulation: **quarterly**.
- Incident response drill: **annual**.

Training records are stored at `compliance/training/<year>/<name>-<course>.md` (or PDF). A missing training that is overdue by more than 30 days is reported to Raymond in the monthly compliance digest and is a blocker on continued access.

### 5.4 90-day and annual check-ins

- **90-day check-in**: James and the new hire meet for a 30-minute review. Topics: what's working, what's confusing, what's missing from the onboarding, compensation alignment. The notes are stored in the personnel file.
- **Annual review**: James runs a 60-minute performance and compensation review. The review covers goals, growth, compensation, and any policy concerns. The review is documented and signed by both parties.

For contractors with multi-year engagements, the 90-day and annual check-ins are replaced by a quarterly business review (QBR) on the SOW deliverables.

## 6. Offboarding — the 24-hour rule

This is the policy section the auditor will test first. The rule is:

> **All access to Solarpro systems, data, and accounts is revoked within 24 hours of the termination effective time, regardless of cause (voluntary, involuntary, retirement, end of contract, or death).**

"Termination effective time" is the moment the decision is communicated in writing to the person, or the moment the contract ends, whichever is earlier. The clock starts at the earliest of those events.

### 6.1 Voluntary termination (resignation)

When a team member resigns:

1. **Day 0**: James receives the resignation in writing (Slack DM, email, or letter). The termination effective time is the end of the notice period (default 2 weeks; can be shorter by mutual agreement).
2. **Within 1 hour of the resignation notice**: James or Raymond informs the team that the person is leaving, on a need-to-know basis. The team is told not to discuss it on Slack until the public announcement.
3. **Within 24 hours of the termination effective time**:
   - Google Workspace account suspended (immediately revokes email, Drive, admin scopes).
   - GitHub org membership removed.
   - Vercel, Render, Neon, Stripe, Resend, Cloudflare, Sentry — admin tokens rotated if they had any, user removed.
   - 1Password access revoked (the hire's personal 1Password is unaffected; the Solarpro vault entry is moved to a "terminated" state).
   - App account: `password_changed_at` set to a future time so all existing tokens (issued before that timestamp) are rejected (`lib/adminAuth.ts:152` + migration 094). The user record is marked `terminated_at`, not deleted, for audit.
   - All admin role cache entries invalidated (the 60-second cache TTL is also force-cleared).
4. **On the last day**: equipment return (laptop, monitor, peripherals, YubiKey if issued, any paper records). Knowledge transfer handoff (see §6.4). Exit interview (see §6.5).
5. **Within 7 days of the termination effective time**: the personnel file is closed. Tax documents (W-2 for US employees; 1099 for US contractors) are issued per IRS timelines. The conflict-of-interest disclosure is re-affirmed in writing — the non-solicitation clause is in effect for 12 months.

### 6.2 Involuntary termination (for cause)

When a team member is terminated for cause:

1. **Immediately upon the termination decision**: James calls Raymond. The termination is communicated to the hire in a private meeting with James and Raymond (or a designated manager). The meeting is short, factual, and ends with the hire escorted to their desk to collect personal items (not the work laptop).
2. **Within 1 hour of the meeting ending**:
   - All access revoked using the §6.1 step-3 checklist, in parallel. Raymond and Cody both run the checklist; Cody handles the technical systems (Vercel, Render, Neon, GitHub) while Raymond handles the productivity systems (Google Workspace, Slack, Linear, app).
   - The hire's laptop and YubiKey are collected before the hire leaves. If the hire refuses, the laptop is wiped remotely (via Find My Mac on the managed Apple ID; the same remote-wipe capability is in scope for any future MDM rollout).
   - The hire's personal device is not searched, but the hire is informed that the work accounts and data are no longer accessible, and that any local copies of work data should be deleted. The Acceptable Use Policy §6 BYOD rules apply.
3. **Within 24 hours**:
   - All admin tokens rotated (Vercel, Render, Neon, Stripe, Resend, Cloudflare, Sentry, 1Password recovery codes).
   - All secrets that the hire had access to are audited; any that the hire could have exfiltrated are rotated.
   - The audit log entries from the prior 30 days are reviewed for unusual access by the terminated hire.
   - The customer-facing team is informed (if the hire had customer contact) that the hire is no longer with the company, with a transition plan for any in-flight customer relationships.
4. **Within 5 business days**:
   - A formal incident review is held, even if the termination was not a security incident — the auditor will look for the review, and the review is the right discipline regardless. The review is documented in `compliance/incidents/<date>-<type>.md`.
   - The legal review is initiated if the cause is willful misconduct, regulatory violation, or customer harm.

### 6.3 End of contract (contractor)

A contractor's access expires on the contract end date. The reminder cadence:

- **14 days before**: the SOW's end date triggers a Linear issue assigned to Raymond. The issue lists the systems to revoke and the equipment to collect.
- **7 days before**: a reminder Slack DM to the contractor (if the engagement is ending cleanly). No reminder if the engagement is being terminated for cause.
- **1 day before**: pre-emptive access check. Anything that has not been used in the prior 7 days is revoked; the rest follows the §6.1 step-3 checklist at the contract end time.
- **On the end date**: all access revoked. Equipment return instructions sent. Final invoice processed per the SOW payment terms.

### 6.4 Knowledge transfer

Knowledge transfer happens during the notice period (voluntary) or in the 24 hours after the termination meeting (involuntary). The format is:

- A 1-2 hour handoff document stored at `Personnel/<Name>/Handoff - <Date>.md` covering: in-flight projects, in-flight customer conversations, scheduled meetings, recurring tasks, and "things only I know."
- A 30-minute handoff meeting per in-flight project with the person taking over.
- For involuntary terminations where the knowledge transfer is compressed: the meeting is recorded (with consent) and the recording is stored in the personnel file. The recording is a last-resort measure, not a default.

The handoff is not optional. A team member who refuses to participate in the knowledge transfer forfeits the post-termination cooperation that is part of the PIIAA; the forfeiture is documented and may affect the final compensation (unused PTO, expense reimbursement, etc., per applicable law).

### 6.5 Exit interview

A 30-minute exit interview is held on or near the last day. The interviewer is **not the hire's direct manager** (to reduce reluctance to be candid). For a 3-person team, this means:

- If the hire was James: exit interview is conducted by an outside HR consultant (engaged per the Vendor Risk Management Policy §5 process). This is a Sprint 3 deliverable (the consultant vendor is not yet on file).
- If the hire was Raymond: exit interview is conducted by James.
- If the hire was Cody: exit interview is conducted by James.

The exit interview covers: what worked, what didn't, what would you change, any concerns you didn't raise during employment. The notes are stored in the personnel file and are confidential to James and the interviewer. Themes (not individual comments) are shared with the team in the next quarterly policy review huddle.

### 6.6 Termination for cause — data recovery

A termination for cause (involuntary) requires a **data recovery review** in addition to the access revocation. The review is owned by Raymond and includes:

1. **All repositories the terminated hire had write access to in the prior 90 days**: review for unusual commits, branch deletions, force-pushes, or dependency changes.
2. **All customer data the terminated hire accessed in the prior 90 days**: review for unusual exports, queries, or bulk reads.
3. **All admin actions the terminated hire took in the prior 30 days**: full audit log review.
4. **All secrets the terminated hire had access to**: rotate every one of them. Cost of rotation is much lower than cost of a leak.
5. **All third-party services the terminated hire had tokens for**: revoke and rotate.
6. **Any cloud-provider activity** (Vercel, Render, Neon, Cloudflare) in the prior 30 days: review for unusual deploys, DNS changes, or DB role grants.

The data recovery review is documented in `compliance/incidents/<date>-termination-data-recovery.md` and is reviewed by James within 5 business days.

## 7. Records and retention

The personnel file for each team member contains:

- Offer letter or SOW (signed).
- I-9 or identity verification record.
- NDA, PIIAA, Code of Conduct, AUP, Data Classification & Handling Policy acknowledgments.
- Annual conflict-of-interest disclosures.
- Annual Code of Conduct acknowledgments.
- Training records (per the Security Awareness & Training Policy).
- 90-day and annual review notes.
- Role change history.
- Offboarding checklist, handoff document, exit interview notes.
- Termination data recovery review (if applicable).

**Retention** (per the Data Classification & Handling Policy §6.1 and the I-9 retention rule):

- Personnel file: **7 years post-termination** for employees; 7 years post-engagement for contractors.
- I-9: 3 years post-hire or 1 year post-termination, whichever is later (USCIS rule).
- Tax documents (W-2, 1099): per IRS rules (4 years minimum, often longer).
- Audit log events for the terminated hire: per the Audit Log retention (7 years hot + indefinite cold).

The personnel file is stored in Google Drive with restricted access (James and Raymond only, by default; the hire's manager in the case of a larger team). The file is **not** deleted when the personnel file retention period ends; it is moved to long-term cold storage.

## 8. Enforcement

A violation of this policy is a security incident and is handled per the Incident Response Plan. Specifically:

- A pre-employment step skipped (no I-9, no signed PIIAA) is a Sev2 — the access is revoked until the step is completed.
- An offboarding step skipped (e.g. access not revoked within 24 hours) is a **Sev1** — the access is revoked immediately, the secrets are rotated, and the auditor is told in the next compliance digest.
- A termination data recovery review skipped is a Sev2.

The Information Security Policy §9 escalation applies for any willful or repeated violation.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation policy, §4 roles.
- `compliance/policies/03-access-control.md` — provisioning, MFA, the 24h rule, quarterly UAR.
- `compliance/policies/04-data-classification-handling.md` — what data the hire can access.
- `compliance/policies/05-incident-response.md` — what to do on a termination-related incident.
- `compliance/policies/11-code-of-conduct.md` — the values and the disciplinary process.
- `compliance/policies/13-security-awareness-training.md` — the training the hire gets.
- `compliance/policies/14-background-check.md` — the screening that is currently deferred.
- `compliance/policies/15-password-authentication.md` — the auth and MFA rules the hire follows.
- `compliance/CONTROL_MATRIX.md` — CC6.2, CC6.3, A.6.1, A.6.2, A.6.3, A.6.5 evidence rows.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. The 24h offboarding rule was already in POL-IS-003 §3.3; this policy is the lifecycle that surrounds it and the explicit SOC 2 hard-requirement evidence. |
