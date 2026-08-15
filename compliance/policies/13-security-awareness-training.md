# Security Awareness & Training Policy

| Field | Value |
|---|---|
| **Policy** | POL-HR-013 — Security Awareness & Training Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro employees and contractors with system access, scaled to a 3-person team |

---

## 1. Purpose

This policy is the training cadence that keeps the security program alive in human heads, not just in the code. It's the **SOC 2 CC1.4 + ISO 27001 A.6.3** evidence for "demonstrates commitment to competence."

For a 3-person team, the cadence is scaled down. The principle is the same: every team member completes the training that is relevant to their role, on the cadence that the role requires, and the completion is recorded. The auditor sees a training register, a training plan, and a tracking artifact. The training is the rule; the tracker is the evidence.

## 2. Principles

1. **Role-relevant, not role-uniform.** A CEO doesn't need a secure-coding training. A backend engineer doesn't need a privacy-messaging training for marketing. The training is sized to the role.
2. **Documented, not assumed.** "Everyone knows this" is not a training record. The completion is a signed acknowledgment, stored in the personnel file.
3. **Recurring, not one-time.** A security primer on day 1 is a snapshot. The threats change. The training recurs.
4. **Actionable, not theoretical.** The training is the kind that changes behavior — phishing simulations, incident response drills, hands-on secure coding. Theory is fine; behavior change is the point.
5. **No-stigma.** Missing a phishing simulation click is a learning moment, not a disciplinary one. The point is to make the team better, not to catch people.

## 3. Training matrix

The required training for each role. "Required" means the team member must complete it on the cadence in the "Cadence" column. "Recommended" means the training is encouraged but not tracked.

| Training | Audience | Cadence | Time | Owner |
|---|---|---|---|---|
| **Security Awareness Primer** (onboarding) | All new hires | Once, on day 1 | 2 hours | Raymond |
| **Annual Security Awareness Refresher** | All employees and contractors | Annual | 1 hour | Raymond |
| **Secure Coding for Engineers** | All engineers (Cody, plus future hires) | Annual | 4 hours (2h training + 2h hands-on) | Cody + Raymond |
| **PII Handling for the Role** | Anyone who handles customer PII (everyone in a 3-person team) | Annual | 1 hour | Raymond |
| **Phishing Simulation** | All employees and contractors | Quarterly | 10 minutes per quarter | Raymond |
| **Incident Response Drill** | All employees (James as IC-sponsor, Raymond as IC) | Annual | 2 hours | Raymond |
| **Privacy Refresher (GDPR/CCPA)** | Anyone with EU or California customer data exposure (all of us) | Annual | 1 hour | Raymond |
| **Vendor Onboarding for Security** | Anyone evaluating a new vendor (all of us) | On demand | 1 hour | Raymond |
| **Crisis Communications Drill** | James (CEO), Raymond (CISO) | Annual | 1 hour | Outside consultant (Sprint 3) |
| **(Recommended) SANS SEC401 or equivalent** | Engineers | Once, on hire | Self-paced, 5-6 days | Individual |

**Optional training (not tracked):**

- Conference talks (Black Hat, DEF CON, OWASP, SANS, USENIX). Any team member can attend and expense it; the talk notes are shared in Slack.
- Vendor webinars (Snyk, Cloudflare, Vercel, Sentry, etc.). Recorded, watched on demand, no tracking.
- Personal study (books, blog posts, CTF challenges). Encouraged, no tracking.

## 4. The 2-hour security primer (onboarding)

The day-1 training for every new hire. Run by Raymond. The format is a slide deck + walkthrough + Q&A, recorded for the personnel file.

### 4.1 Topics

1. **Solarpro's threat model** (15 min). Who might want to compromise us, what they would want, how they would get in. The realistic adversaries: a phishing email, a leaked credential, a misconfigured S3 bucket, a supply-chain attack via a dependency, a malicious npm package. Not nation-state APTs (we are not a high-value target for that yet; we are for credential stuffing and supply-chain).
2. **The 5 policies everyone reads first** (15 min). Information Security, Access Control, Data Classification, Incident Response, Code of Conduct. The 5-minute version of each, with the auditor's question and our answer.
3. **MFA and passwords** (10 min). Why MFA matters, what TOTP vs WebAuthn vs SMS gives us, what a good passphrase looks like. The 12-character minimum and the breach-dictionary check.
4. **Phishing** (15 min). How to spot a phish, what to do when you receive one, the "report don't click" rule. The simulated phishing examples from prior quarters.
5. **PII handling** (15 min). What is PII at Solarpro, where it lives (Neon, never on the laptop), what can leave the system (signed DPAs only), what to do if PII is sent to the wrong place.
6. **Incident response: your first 15 minutes** (15 min). Who you call (Raymond, then James), what you don't do (don't delete logs, don't broadcast, don't try to fix it yourself), how the Sev1 / Sev2 / Sev3 classification works.
7. **Acceptable Use highlights** (10 min). The AI-tool restriction on customer data, the personal-device rule, the no-shared-credentials rule.
8. **Q&A** (15 min). Anything the new hire wants to ask.

The deck is stored at `compliance/training/security-primer-deck.md`. The training is recorded (with consent) and stored at `compliance/training/<year>/<name>-security-primer.mp4`.

### 4.2 Tracking

The 2-hour security primer is **a precondition for any system access** (other than the read-only access used to take the training itself). The Linear issue for day-1 onboarding is not closed until the training is complete.

## 5. Role-specific training

### 5.1 Secure Coding for Engineers (Cody + future engineers)

Annual, 4 hours (2h training + 2h hands-on). Run jointly by Cody (technical lead) and Raymond.

**Topics (the 2h training):**

1. **OWASP Top 10** — what they are, the Solarpro-specific examples, the defenses we already have.
2. **Authentication and session** — JWT, HS256 vs RS256, refresh tokens, MFA, why role comes from the DB not the JWT.
3. **Authorization** — default-deny, `checkOrgAuthz()`, `requireAdminApi()`, ADR-004 (platform role ≠ org role).
4. **Input validation** — Zod schemas, length caps, the `isGibberish` and `isDisposableEmail` checks, the survey PII length caps.
5. **Secrets handling** — 32-character minimum, GitHub Actions encrypted secrets, the `getJwtSecret()` runtime check, the recent security quickwins PR.
6. **Dependency security** — `npm audit` in CI, Dependabot, the Snyk weekly scan, the overrides pattern.
7. **Cryptography** — when to use bcrypt vs JWT vs HMAC vs AES-GCM, why timing-safe equality matters.
8. **Logging and monitoring** — the 12-field schema, the `safeViewerOp()` helper, the `redacted_fields` column.
9. **Threat modeling for a PR** — the 5-minute check: what data does this touch, what authz applies, what audit events fire, what could go wrong.
10. **The Solarpro "secure coding standard"** — a 1-page doc, the `AGENTS.md` R-rules, the 4-gate migration governance.

**Hands-on (the 2h):**

A deliberately vulnerable PR is opened against a sandbox repo. The team members find and fix the vulnerabilities. Common examples: SQL injection in a query, an unvalidated redirect, a missing authz check, a hardcoded API key, an XSS in a user-supplied string. The exercise is graded on completeness, not speed.

The 2h training deck is at `compliance/training/secure-coding-deck.md`. The hands-on repo is at `compliance/training/secure-coding-sandbox/`.

### 5.2 PII Handling for the Role (everyone in a 3-person team)

Annual, 1 hour. Run by Raymond.

**Topics:**

1. **What is PII at Solarpro** — homeowner (name, address, phone, email, photos, derived measurements), inspector (name, email, phone, company, license), payment (delegated to Stripe, not us), credentials, security telemetry.
2. **The data classification scheme** — Public / Internal / Confidential / Restricted (per POL-IS-003 §2).
3. **Where PII can go** — within Solarpro systems, to a sub-processor with a signed DPA, to the customer. Not to a personal device, not to an AI tool without an exception, not to a personal email.
4. **EXIF stripping** — what is in an aerial photo by default (GPS coordinates, device ID, timestamp), what is stripped on upload, why.
5. **The 72-hour breach clock** — GDPR Art. 33 (supervisory authority), Art. 34 (data subject). The Incident Response Plan §5.5 is the runbook.
6. **The data subject rights** — access, correction, deletion, portability. The Data Subject Rights Policy (forthcoming) is the operational rule.

The training is recorded (with consent) and stored in the personnel file.

### 5.3 Crisis Communications Drill (James + Raymond)

Annual, 1 hour. Run by an outside consultant (vendor to be selected; the consultant is the same firm that runs the exit interview for James when the time comes — Sprint 3 deliverable).

**Format:** A simulated Sev1 scenario is presented (e.g. "customer PII has been posted to a public pastebin"). James and Raymond role-play the first 60 minutes:

- What do we know?
- What do we say to the customer?
- What do we say to the public?
- What do we say to the press (if contacted)?
- What do we say to the auditor (when they call)?

The drill is graded on clarity, accuracy, and adherence to the Incident Response Plan §5 communications runbook. The drill is recorded and reviewed by James and Raymond afterward; the recording is not shared.

## 6. Phishing simulation

Quarterly. Run by Raymond (or a vendor, when one is selected — KnowBe4 and Proofpoint are the two candidates; selection deferred until budget permits).

### 6.1 The cadence

- **Q1 (January)**: a credential-harvest phish. The email looks like a Google Workspace password-reset prompt or a DocuSign request.
- **Q2 (April)**: a vendor-invoice phish. The email looks like a Stripe or Resend billing alert.
- **Q3 (July)**: a customer-themed phish. The email looks like a customer asking for an account change or a refund.
- **Q4 (October)**: an internal-themed phish. The email looks like a Slack, Linear, or GitHub notification.

The phish is realistic but harmless. The link goes to a Solarpro-controlled "report this phish" page that thanks the reporter and logs the click-or-report event.

### 6.2 The rule

- **Click**: a learning email goes to the clicker the same day. "You clicked on a simulated phish. Here's what you would have given away. Here's what to look for next time." No disciplinary action. Repeated clicks in the same quarter (>2) trigger a coaching conversation with Raymond.
- **Report**: a thank-you in `#announcements` (anonymous aggregate) and a note in the personnel file. Reports are celebrated.
- **Neither (the email was ignored)**: that's fine. Ignored phish is a successful test of the awareness training.

### 6.3 Tracking

The click-or-report log is stored at `compliance/training/phishing/<year>/<quarter>.csv`. The aggregate metrics (% click, % report) are reported in the monthly compliance digest. A click rate above 20% in a quarter is a signal that the awareness training needs to be adjusted.

## 7. Incident response drill

Annual, 2 hours. Run by Raymond (IC) with James and Cody participating.

The format is a tabletop exercise. A scenario is presented (e.g. "an admin API key has been committed to a public GitHub repo by a third-party service"). The team walks through:

1. **Detection** — how would we know? (Dependabot, Sentry, UAR, customer report)
2. **Classification** — Sev1, Sev2, or Sev3? (per the Incident Response Plan §3)
3. **Containment** — what do we do in the first hour? (rotate the key, revoke the token, etc.)
4. **Eradication** — what do we do in the first 24 hours? (audit log review, blast radius, customer notification)
5. **Recovery** — what do we do in the first week? (re-issue keys, customer outreach, post-incident review)
6. **Communication** — who do we tell, in what order, with what wording?

The drill is run on a real (but non-critical) scenario — for example, a leaked `RESEND_API_KEY` rather than a leaked `JWT_SECRET`. The drill is documented in `compliance/training/incident-drills/<year>-<scenario>.md` and the post-drill improvements are tracked in the Incident Response Plan revision history.

The 2026 drill was held on **2026-08-15** with the rate-limiter fail-open scenario (the 2026-08-12 incident). The PIR is in `compliance/incidents/2026-08-12-rate-limiter-fail-open.md` and the drill is in `compliance/training/incident-drills/2026-rate-limiter.md`.

## 8. Tracking and consequences

### 8.1 The training register

The training register is at `compliance/training/register.csv`. The schema:

```
name, course, due_date, completed_date, evidence_path, status
```

- `name`: the team member.
- `course`: the training name from §3.
- `due_date`: the date the training should be complete.
- `completed_date`: the date the training was actually complete.
- `evidence_path`: the path to the signed acknowledgment, recording, or completion certificate.
- `status`: one of `pending`, `in_progress`, `complete`, `overdue`, `exempt` (with reason).

The register is reviewed by Raymond on the 1st business day of each month. Overdue items are flagged in the monthly compliance digest.

### 8.2 Consequences of missing training

A training that is overdue is handled as follows:

| Overdue period | Action |
|---|---|
| **0-30 days** | Email reminder to the team member. Listed in the monthly compliance digest as "overdue, not yet escalated." |
| **30-60 days** | Coaching conversation with Raymond. Listed in the monthly compliance digest as "overdue, in coaching." |
| **60-90 days** | James is informed. Access is downgraded (e.g. admin → user) until the training is complete. |
| **>90 days** | Access is suspended (with a 7-day notice) until the training is complete. Listed in the next UAR. |

For the **2-hour security primer** at onboarding, missing it is a blocker on day-1 access. The hire is paid for the time but is not given any account beyond the read-only training portal.

### 8.3 Exceptions

A training exception is documented in the same way as a control exception: a Linear issue tagged `compliance-exception` with the training, the rationale, the duration, and the compensating control. Approved by Raymond (CISO); max 90 days. Disclosed to James for any training tied to a P0 control (the security primer, the secure coding training, the incident response drill).

Examples of acceptable exceptions: a contractor with a 2-week engagement doesn't need the full annual refresher; a hire who completed the equivalent training at a prior employer within the past 12 months can carry over the credit (with documentation).

## 9. The 3-person team reality

Today (2026-08-15) the team is James, Raymond, and Cody. The training matrix scales:

- **James** completes: Security Awareness Primer (done, 2026-XX-XX), Annual Refresher, PII Handling, Privacy Refresher, Phishing Sim (quarterly), Crisis Comms Drill. Total ~6 hours/year. James is the management sign-off; training is a management discipline for him.
- **Raymond** completes: Security Awareness Primer (done), Annual Refresher, PII Handling, Privacy Refresher, Phishing Sim, Incident Response Drill, Crisis Comms Drill. Plus: he runs the others' training. Total ~10 hours/year of being trained + 30-40 hours/year of running training.
- **Cody** completes: Security Awareness Primer, Annual Refresher, Secure Coding, PII Handling, Privacy Refresher, Phishing Sim, Incident Response Drill. Total ~12 hours/year. He co-runs the secure coding training with Raymond.

The completion records for all three are at `compliance/training/`. The first cycle is the policy effective date (2026-08-15) for the security primer; the annual cadence starts on that date for the refresher and the role-specific training.

The team scales linearly. At 5 people, the role split stays the same; the total time commitment grows. At 10 people, a learning management system (LMS) is needed — the LMS is the Sprint 3 vendor selection. At 3 people, a shared folder and a CSV register is enough.

## 10. Related documents

- `compliance/policies/01-information-security.md` — foundation policy.
- `compliance/policies/03-access-control.md` — the auth and MFA rules the training reinforces.
- `compliance/policies/05-incident-response.md` — the IR plan the drill rehearses.
- `compliance/policies/11-code-of-conduct.md` — the values the primer covers.
- `compliance/policies/12-employee-onboarding-offboarding.md` — the lifecycle that triggers the primer.
- `compliance/training/` — the training register, decks, recordings, and phishing-simulation logs.
- `compliance/incidents/` — the post-incident reviews the drill scenarios are drawn from.
- `compliance/CONTROL_MATRIX.md` — CC1.4, A.6.3 evidence rows.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Sized to the 3-person team with a path to LMS at 10 people. |
