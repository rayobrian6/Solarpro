# Business Continuity & Disaster Recovery Plan

| Field | Value |
|---|---|
| **Policy** | POL-OP-022 — Business Continuity & Disaster Recovery Plan |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) and after every annual DR exercise (the exercise always identifies at least one improvement) |
| **Scope** | Every disruption that could prevent Solarpro from serving customers, processing surveys, generating proposals, or meeting audit-evidence retention. Includes vendor outages, security incidents, mass personnel unavailability, and the multi-system failure scenarios that the Backup & Recovery Policy (#09) does not cover. |

---

## 1. Purpose

This policy is the operational rule for **what Solarpro does when the Backup & Recovery Policy (#09) is not enough**. Policy 09 covers "the data is recoverable" — a single Neon restore, a Vercel rollback, a Render redeploy. This policy covers the broader scenario: a multi-system outage, a vendor going dark, a security incident that takes the application offline, a mass personnel unavailability, a regional disaster that affects multiple vendors at once. It's the **SOC 2 CC9.1 + ISO 27001 A.5.29 + A.5.30 + ISO 27017 A.5.30** evidence: that Solarpro has a documented plan for business continuity, that the plan is tested, and that the plan is the playbook the team reaches for when the alert fires.

The auditor's question is not "do you have a BC/DR plan?" — it's "can you pick up this document, follow the steps, and recover the business in a known time?" This policy is written to be that document. A 3-person team has no on-call rotation; the plan is the rotation. Every step has an owner, a time bound, and a verification.

The 3-person team constraint defines the shape of the plan. There is no 24/7 on-call rotation. There is no redundant operations team. There is no DR site. The plan is **asynchronous-by-default**: every step is documented so the right person can do it whenever they pick up the alert, not at 3am. The plan also assumes **vendor continuity** — Solarpro does not run its own data center, so the DR plan is "switch vendors" or "restore from a vendor backup," not "stand up our own hardware." The 2026-07-30 control matrix row CC9.1 is the trigger for this policy; the row was Partial, missing the documented RTO/RPO targets and the failover test cadence. This policy closes that gap.

## 2. The 3-person team reality

Today (2026-08-15) the team is James, Raymond, and Cody. The BC/DR plan runs on three assumptions:

1. **One person can drive any recovery step.** Every step in §6 (recovery procedures) and §7 (communication plan) is documented so a single person can execute it. The other two are backup. The "primary / backup" ownership is in §8.
2. **The alert channel is asynchronous.** A PagerDuty-style on-call rotation is not feasible at 3 people. The alert channel is a combination of Sentry (production errors), Vercel/Render/Neon status pages, and email. The first person to see the alert becomes the Incident Commander (IC) until the formal handoff in §7.
3. **The vendor is the first responder.** Every Tier 1 vendor (Vercel, Neon, Render, Cloudflare, Stripe) has 24/7 support with a published SLA. A vendor outage is a joint incident; the vendor's incident response team is the first responder, Solarpro is the second. The plan coordinates with the vendor's status page, not against it.

The plan is designed to scale linearly with headcount. At 5 people, the alert channel adds a shared Slack channel and a weekly on-call rotation. At 10, the alert channel adds PagerDuty or equivalent. The §6 / §7 / §8 rules are independent of team size; the alert mechanism is the only thing that changes.

## 3. Recovery targets

The recovery targets are the same as the Backup & Recovery Policy (#09) §3, summarized here for the BC/DR context. The targets are commitments, not aspirations; missing a target is a Sev2 incident with a written rationale for the deviation.

| Tier | System | RTO | RPO | Notes |
|---|---|---|---|---|
| **Tier 1 (production-critical)** | Production database (Neon) | **4 hours** | **1 hour** | RPO covered by Neon PITR (continuous, 7-day window). RTO assumes a fresh Neon project can be provisioned and PITR-restored within the window. |
| **Tier 1 (production-critical)** | Customer-facing app (Vercel) | **4 hours** | **Last successful deploy** | RTO is the Vercel redeploy + smoke test. RPO is the previous deploy. |
| **Tier 1 (production-critical)** | SAM2 service (Render) | **4 hours** | **Last successful deploy** | RTO is the Render redeploy + cold start (≤15 min). |
| **Tier 2 (operational)** | Full stack (app + DB + services) | **24 hours** | **1 hour** | The Tier 2 RTO assumes the Tier 1 RTOs are met and the application can be redeployed end-to-end with a smoke test. |
| **Tier 2 (operational)** | Evidence store (R2) | **24 hours** | **24 hours** | The R2 evidence is rarely written; the RPO is the last successful daily snapshot. |
| **Tier 3 (non-critical)** | Marketing site (Vercel) | **24 hours** | **Last successful deploy** | The marketing site is a separate Vercel project; a deploy failure does not affect the application. |
| **Tier 3 (non-critical)** | Internal docs (git) | **24 hours** | **Last commit** | Git is the backup; the docs are recoverable from any clone. |
| **Tier 4 (vendor-managed)** | Stripe, Resend, OpenAI, Anthropic, Google Solar, Nearmap, Eagleview | **Vendor SLA** | **Vendor SLA** | Inherited from the vendor's published SLA and SOC 2 report. |

The 4-hour Tier 1 RTO is the operational rule. A Tier 1 outage that exceeds the 4-hour RTO is a Sev2 incident. A Tier 1 outage that exceeds the 8-hour mark (double the RTO) is a Sev1 incident and triggers the post-incident review per the Incident Response Plan (#05).

The targets are measured in the §6 quarterly restore tests. If the test consistently lands inside the targets, the targets are confirmed. If the test consistently exceeds them, the targets are revised with a written rationale and the §10 review cadence.

## 4. Disaster scenarios

The plan covers the seven disaster scenarios that the 3-person team is most likely to face. Each scenario has a §6 procedure, a §7 communication plan, and a §8 ownership table. The list is not exhaustive; the framework applies to any scenario not listed (the "unknown unknowns" are handled by the §10 review).

### 4.1 Neon region outage

The Neon production database is in a single region (us-east-1 today; the team will revisit the region choice in the §10 review). A Neon regional outage takes the production database offline. The recovery is a Neon PITR restore to a new project, then a Vercel env var update to point at the restored project. The RTO is the time to provision + restore + swap, typically 1-2 hours.

### 4.2 Vercel platform outage

A Vercel platform outage takes the Next.js application offline. The recovery is a redeploy to a different platform (Render or a temporary static export to Cloudflare R2 + Pages). The RTO is the time to redeploy + DNS swap, typically 30-60 minutes. The application is stateless; the database is the only stateful dependency.

### 4.3 Render service outage

A Render service outage takes the SAM2 service offline. The recovery is a redeploy to a different platform (Fly.io, Railway, or a temporary Vercel Serverless Function). The RTO is the time to redeploy + cold start, typically 15-30 minutes. The SAM2 service is asynchronous (webhook callback); a brief outage does not affect the customer-facing app.

### 4.4 Cloudflare outage

A Cloudflare outage affects DNS and CDN. The recovery is to update the nameservers at the registrar (the registrar is Cloudflare Registrar, so the recovery is a manual update from the registrar dashboard) and to use the Vercel-provided DNS as a fallback. The RTO is the time to update the nameservers, typically 15-30 minutes (the registrar's propagation time).

### 4.5 GitHub outage

A GitHub outage prevents code deploys and source-code recovery. The recovery is to use a local clone of the repository (every team member has a local clone, refreshed daily) and to deploy via the Vercel/Render CLI instead of the GitHub integration. The RTO is the time to clone + redeploy, typically 30-60 minutes.

### 4.6 Mass personnel unavailability

A scenario where two or more of James, Raymond, Cody are unavailable (illness, accident, departure). The recovery is the §8 backup ownership: every step has a primary and a backup. A 1-person scenario is operationally difficult; the plan documents the minimum viable operations (the things that must keep running — the production database, the customer-facing app, the customer support inbox) and the things that can pause (the SBOM generation, the patch-management weekly review, the UAR).

### 4.7 Security incident (ransomware, breach, key compromise)

A security incident that takes a system offline. The recovery is per the Incident Response Plan (#05): containment, eradication, recovery, postmortem. The key compromise procedure is in the Encryption & Key Management Policy (#21) §8. The ransomware-specific procedure is the §6.7 step-by-step in this policy.

## 5. Backup procedures

The backup procedures are the input to the recovery procedures. A backup that has never been tested is a hope, not a backup. The Backup & Recovery Policy (#09) §4 documents the per-system backup mechanism; this section summarizes the cadence and the verification.

| System | Backup mechanism | Cadence | Retention | Verification |
|---|---|---|---|---|
| **Production database (Neon)** | Neon PITR (continuous write-ahead log) | Continuous | 7-day window | Weekly existence check (Policy 09 §5.1) |
| **Evidence store (R2)** | Daily snapshot of the `compliance/` tree | Daily | 7 years (R2 lifecycle) | Daily snapshot completeness check (Policy 09 §5.1) |
| **Deployment history (Vercel)** | Every deploy retained by Vercel | Per deploy | 90 days (Vercel's default) | Weekly deploy-history check (Policy 09 §5.1) |
| **Deployment history (Render)** | Every deploy retained by Render | Per deploy | 90 days (Render's default) | Weekly deploy-history check (Policy 09 §5.1) |
| **Source code (GitHub)** | All commits, PRs, issues, actions, releases | Per commit | Indefinite (GitHub retention) | Git is the backup; the clone is the verification |
| **SAM2 model artifacts** | Git (the ONNX INT8 weights) + Render deploy bundle | Per deploy | Indefinite (git) | Weekly Render deploy-history check |
| **Secrets** | Vercel env vars + Render env vars + 1Password | n/a (rotation is the recovery, per Policy 21 §6) | n/a | Weekly env-fingerprint check (`compliance/monitoring/env-fingerprint-<date>.json`) |

The offsite posture is the cloud provider's posture: every backup is in a different region than the primary (R2 multi-region, Neon PITR stored in a separate region, GitHub is in the US, Vercel/Render are in the US). A regional disaster that takes out the primary and the backup is a Tier 1 incident; the recovery is the §4.1-4.5 procedures.

## 6. Recovery procedures (the playbook)

This is the section the team reaches for when the alert fires. Every procedure has a primary owner, a time bound, a verification step, and a handoff.

### 6.1 Neon region outage

**Trigger**: Sentry alert on database connection failures, OR Neon status page incident, OR Vercel 5xx spike with database errors.

**Procedure**:

1. **Confirm the outage (5 min)**. Raymond (or whoever is IC) checks the Neon status page (https://neonstatus.com) and the production database connection from the Vercel logs. The 5-minute threshold avoids reacting to a transient blip.
2. **Open the incident (5 min)**. The IC declares a Sev1 incident, opens an incident file at `compliance/incidents/<date>-neon-outage.md`, and notifies James and Cody per the §7 communication plan.
3. **Provision a restore project (15-30 min)**. In the Neon dashboard, create a new project in a different region (or the same region, if the region is the issue, the restore is to a different Neon region). Use Neon PITR to restore the production database to a point 5 minutes before the outage started.
4. **Verify the restore (10 min)**. Check row counts against the most recent production snapshot. Spot-check 10 random rows in the `users`, `projects`, `proposals`, `surveys`, `audit_log`, and `permit_snapshots` tables. Verify the audit log is intact (the `request_id` continuity is unbroken).
5. **Swap the connection (5 min)**. Update the `DATABASE_URL` env var in Vercel to point at the restored project. The application reconnects on the next request. Verify with a smoke test (login, project list, survey submit, proposal create).
6. **Notify customers (15 min)**. Per the §7 communication plan. The customer-facing message is on the status page (forthcoming) and on the in-app banner.
7. **Postmortem (within 5 business days)**. The IC writes a postmortem per the Incident Response Plan (#05) §7. The postmortem includes the actual RTO achieved, the actual RPO achieved, the diff from the §3 targets, and any action items.

**Time**: 1-2 hours, well inside the 4-hour RTO.

### 6.2 Vercel platform outage

**Trigger**: Vercel status page incident, OR Sentry alert on cold-start failures, OR Cloudflare 502/503 spike.

**Procedure**:

1. **Confirm the outage (5 min)**. Check the Vercel status page (https://vercel-status.com).
2. **Open the incident (5 min)**. The IC declares a Sev1, opens an incident file, notifies James and Cody.
3. **Redeploy to Render (30-60 min)**. The Next.js app can be containerized and run on Render as a fallback. The Dockerfile and the Render config are in `sam2-service/` (the SAM2 service uses a similar pattern; the app can be adapted). The deploy is via the Render CLI or dashboard.
4. **Swap the DNS (15-30 min)**. Update the DNS at Cloudflare to point the apex and `app.solarpro.app` at the Render IP. The Vercel-provided DNS is the backup; the registrar-level NS update is the nuclear option.
5. **Verify (15 min)**. Smoke test the top 5 customer flows. Verify the database connection.
6. **Swap back when Vercel recovers**. Once Vercel is healthy, redeploy to Vercel and swap the DNS back. Verify.
7. **Postmortem (within 5 business days)**. The IC writes a postmortem.

**Time**: 1-2 hours, well inside the 4-hour RTO.

### 6.3 Render service outage

**Trigger**: Render status page incident, OR Sentry alert on SAM2 service failures, OR SAM2 callback timeouts.

**Procedure**:

1. **Confirm the outage (5 min)**. Check the Render status page (https://status.render.com).
2. **Open the incident (5 min)**. Sev2 (the customer-facing app is unaffected; the SAM2 service is asynchronous).
3. **Redeploy to Fly.io (30-60 min)**. The Dockerfile is portable. The Fly.io config is in `sam2-service/fly.toml` (forthcoming; the Render → Fly.io migration is a planned Sprint 2 follow-up).
4. **Update the callback URL (10 min)**. The SAM2 service is called by Vercel webhooks; the Vercel env var `SAM2_SERVICE_URL` is updated to the Fly.io URL.
5. **Verify (15 min)**. Run a smoke test of the SAM2 inference path.
6. **Postmortem (within 5 business days)**. The IC writes a postmortem.

**Time**: 1-2 hours, well inside the 4-hour RTO.

### 6.4 Cloudflare outage

**Trigger**: Cloudflare status page incident, OR DNS resolution failures, OR 502/503 spike at the Cloudflare edge.

**Procedure**:

1. **Confirm the outage (5 min)**. Check the Cloudflare status page (https://www.cloudflarestatus.com).
2. **Open the incident (5 min)**. Sev1 (DNS outage takes the app offline).
3. **Update the nameservers (15-30 min)**. The registrar is Cloudflare Registrar; the NS update is from the Cloudflare dashboard. If the Cloudflare dashboard is also down, the recovery is a manual NS update from the registrar's API (Cloudflare Registrar has an API; the alternative is to call support).
4. **Use Vercel DNS as a fallback**. Vercel provides DNS for `solarpro.app`; the Vercel dashboard is reachable when Cloudflare is down. The NS update points to Vercel's nameservers.
5. **Verify (15 min)**. DNS propagation check; smoke test the app.
6. **Swap back when Cloudflare recovers**. Once Cloudflare is healthy, update the NS back to Cloudflare.
7. **Postmortem (within 5 business days)**. The IC writes a postmortem.

**Time**: 30-60 minutes, well inside the 4-hour RTO.

### 6.5 GitHub outage

**Trigger**: GitHub status page incident, OR inability to push/pull, OR GitHub Actions failing.

**Procedure**:

1. **Confirm the outage (5 min)**. Check the GitHub status page (https://www.githubstatus.com).
2. **Open the incident (5 min)**. Sev2 (the app is unaffected; deploys are paused).
3. **Use the local clone (30-60 min)**. Every team member has a local clone of the repository, refreshed daily via `git fetch`. The deploy is via the Vercel CLI (`vercel deploy`) or the Render CLI (`render deploy`) instead of the GitHub integration.
4. **Verify (15 min)**. Smoke test the app.
5. **When GitHub recovers, push the deferred commits**. The local clones are the source of truth during the outage.
6. **Postmortem (within 5 business days)**. The IC writes a postmortem.

**Time**: 1-2 hours, well inside the 4-hour RTO.

### 6.6 Mass personnel unavailability

**Trigger**: two or more of James, Raymond, Cody are unavailable (illness, accident, departure).

**Procedure**:

1. **Confirm the unavailability (within 4 hours)**. The team agrees (via email, Slack, or phone) that the unavailability is real and not a communication failure.
2. **Activate the backup ownership (immediately)**. The §8 table is the primary / backup ownership. If the IC is unavailable, the backup becomes the IC. If the technical lead is unavailable, the CISO performs the technical steps (or vice versa). If the CEO is unavailable, the CISO is the acting decision-maker for material commitments.
3. **Triage the in-flight work (within 24 hours)**. The acting IC reviews the in-flight work (the open PRs, the open incidents, the customer support queue, the scheduled deploys) and decides what to pause and what to keep running. The minimum viable operations are: the production database, the customer-facing app, the customer support inbox, the incident response.
4. **Notify customers and investors (within 24 hours)**. Per the §7 communication plan. The message is: "Solarpro is operational; the team is reduced; we expect the same SLA."
5. **Engage temporary help (within 1 week)**. The team engages a contract engineer (per the Third-Party Service Provider Policy #16 Tier B rules) for technical coverage and a contract CISO (per the same) for security review. The engagement is documented in the incident file.
6. **Postmortem (within 5 business days of recovery)**. The IC writes a postmortem that includes the impact on customers, the financial impact, and the staffing recommendations for the future.

**Time**: the response is asynchronous; the SLA is "within 4 hours" for the activation, "within 24 hours" for the triage and notification.

### 6.7 Security incident (ransomware, breach, key compromise)

**Trigger**: Sentry alert on suspicious activity, OR a key compromise detection (per the Encryption & Key Management Policy #21 §8), OR an external report (a customer, a vendor, a security researcher).

**Procedure**:

1. **Contain (immediately)**. The IC follows the Incident Response Plan (#05) §5. The first step is to contain the incident: revoke the compromised credential, isolate the affected system, block the malicious traffic.
2. **Eradicate (within 4 hours)**. Remove the malicious code, the unauthorized access, the exfiltrated data. The key rotation per Policy 21 §8 is the first eradication step for a key compromise.
3. **Recover (within 24 hours)**. Restore the affected system from the last known-good backup (Neon PITR, Vercel rollback, Render redeploy, R2 evidence reconstruction). The recovery is the §6.1-6.5 procedure for the affected system.
4. **Notify (within 72 hours for GDPR supervisory authority; per the Privacy Policy #18 §9 for the data subject)**. The breach notification is per the Privacy Policy (#18) §9 and the Data Subject Rights Policy (#19) for the GDPR/CCPA timelines. For a non-PII incident, the notification is per the customer communication plan in §7.
5. **Postmortem (within 5 business days)**. The IC writes a postmortem per the Incident Response Plan (#05) §7. The postmortem includes the root cause, the impact, the response, and the action items to prevent recurrence.

**Time**: containment is immediate; eradication is within 4 hours; recovery is within 24 hours; notification is within 72 hours (per GDPR). The total time is well inside the §3 RTO/RPO targets for the affected system.

## 7. Communication plan

The communication plan is the rule for **who calls whom, in what order, with what message**. The plan is asynchronous-by-default (no PagerDuty rotation at 3 people). The plan is also documented as a template, so the IC can adapt the message to the specific incident.

### 7.1 The escalation order

The escalation order is fixed. The IC escalates up the order, not laterally.

1. **IC (Incident Commander)** — the first person to see the alert. The IC drives the §6 procedure.
2. **Raymond O'Brien (CISO)** — if the IC is not Raymond, the IC notifies Raymond within 15 minutes of opening the incident. Raymond is the security decision-maker.
3. **Cody (Technical lead)** — if the IC is not Cody, the IC notifies Cody within 15 minutes. Cody is the technical decision-maker.
4. **James Carpenter (CEO)** — the IC notifies James within 30 minutes of opening the incident. James is the management decision-maker.
5. **Customers** — the IC notifies customers within 1 hour of opening the incident. The channel is the in-app banner, the status page, and email (for Sev1).
6. **Investors** — James notifies investors within 4 hours of opening the incident. The channel is email.
7. **Vendors** — the IC notifies the affected vendor within 4 hours of opening the incident. The channel is the vendor's support portal.
8. **Auditor / regulator** — James notifies the auditor (if engaged) within the regulator-mandated timeline. For a PII breach, the supervisory authority is notified within 72 hours (GDPR Art. 33).

The escalation order is the **default**. The IC can skip steps (e.g. notify James before Cody) if the incident warrants it. The escalation is documented in the incident file with the timestamp for each step.

### 7.2 The message template

The IC uses a fixed template for the initial notification. The template is at `compliance/incidents/_TEMPLATE.md` and includes:

- **Incident ID** (e.g. `INC-2026-08-15-001`).
- **Severity** (Sev1 / Sev2 / Sev3).
- **System affected** (Neon, Vercel, Render, Cloudflare, etc.).
- **Impact** (what the customer sees).
- **ETA** (best guess at the recovery time).
- **Action items** (what the team is doing).
- **Next update** (when the next communication will go out).

The template is a living document; the team updates it after every incident based on what worked and what did not.

### 7.3 The status page

The status page is the customer-facing channel. The page is at `https://status.solarpro.app` (forthcoming; the page is a Sprint 2 follow-up). The IC posts an update to the status page within 15 minutes of opening the incident. The update is short (a paragraph) and links to the in-app banner for the long-form explanation.

Until the status page is live, the customer-facing channel is the in-app banner + email. The IC updates the banner via the admin UI; the email is sent via Resend.

## 8. Roles and responsibilities

The §8 table is the **primary / backup** ownership. Every §6 step has a primary; every step has a backup. The backup can perform the step if the primary is unavailable; the backup cannot perform the step silently — the backup notifies the IC that they are taking the step.

| Step | Primary | Backup |
|---|---|---|
| **Confirm the outage (§6.1-6.5)** | Raymond | Cody |
| **Open the incident** | The first person to see the alert becomes the IC | The next person who sees the alert |
| **Provision a restore (§6.1)** | Cody | Raymond |
| **Redeploy to fallback platform (§6.2-6.5)** | Cody | Raymond |
| **Swap the connection / DNS** | Cody | Raymond |
| **Verify (smoke test)** | Cody | Raymond |
| **Notify customers** | James | Raymond |
| **Notify investors** | James | n/a (James is the only one with the contact list) |
| **Notify vendors** | Cody (for the technical contact) or James (for the executive contact) | Raymond |
| **Postmortem** | The IC | Raymond (if the IC is unavailable) |

The "primary / backup" pattern means that the team can lose one person and the plan still runs. Losing two people is the §6.6 scenario.

## 9. Testing the plan

A plan that has never been tested is a hope, not a plan. The plan is tested on three cadences, matching the Backup & Recovery Policy (#09) §5.

### 9.1 Quarterly — full restore test

**Owner**: Raymond (CISO) + Cody (technical lead).

**What it covers**: a real restore of the production database to a non-production environment, plus a real Vercel + Render redeploy to a staging environment, plus a real R2 inventory check. The full procedure is the Backup & Recovery Policy (#09) §5.2.

**Output**: a quarterly restore test report at `compliance/monitoring/<quarter>-restore-test.md`. The report includes the achieved RTO, the achieved RPO, the diff from the §3 targets, and any action items.

**Frequency**: every quarter. The first test is in Q3 2026 (90 days after this policy takes effect).

### 9.2 Annual — tabletop exercise

**Owner**: Raymond + James + Cody.

**What it covers**: a tabletop walkthrough of a full-stack outage scenario. The scenario is designed to exercise the §6 procedures and the §7 communication plan. The exercise is 2-3 hours; the team walks through a hypothetical scenario, decides on the actions, and identifies gaps in the plan.

**The 2026 exercise (Q4 2026)**. The first annual exercise is scheduled for Q4 2026, after the Q3 2026 restore test. The scenario is a **Neon region outage** (the most likely Tier 1 scenario). The exercise is led by Raymond; James and Cody participate.

**Output**: an exercise report at `compliance/incidents/<date>-dr-tabletop.md`. The report includes the scenario, the team's actions, the gaps identified, and the action items for the next quarter.

**Frequency**: annually. Combined with the Incident Response Plan (#05) tabletop.

### 9.3 Ad-hoc — after a real incident

**Trigger**: any Sev1 or Sev2 incident.

**What it covers**: a real-incident retrospective. The retrospective is per the Incident Response Plan (#05) §7 and includes the §6 procedure that was followed, the actual RTO/RPO achieved, the gaps identified, and the action items.

**Output**: a postmortem at `compliance/incidents/<date>-<incident>.md`.

**Frequency**: every Sev1 or Sev2 incident.

## 10. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §3 targets (the targets may need to change as the team grows and the customer base expands), a refresh of the §4 scenarios (new scenarios may have emerged), and a refresh of the §6 procedures (the procedures may have drifted from the actual vendor dashboards).
- **After every annual DR exercise** — the exercise always identifies at least one improvement. The improvement is added to the §6 procedure and the §10 review is updated.
- **After every Sev1 incident** — the postmortem identifies gaps in the plan. The gaps are added to the §6 procedure or the §3 targets.
- **On material change** — within 30 days of any of: a new Tier 1 vendor, a vendor change (e.g. switching from Vercel to a different platform), a new framework in scope (e.g. FFIEC for a financial-services customer), or a change in the team (a new hire, a departure).

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 11. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management, exceptions process.
- `compliance/policies/05-incident-response.md` — the operational rule for a security incident; the §6.7 procedure references this.
- `compliance/policies/06-change-management.md` — when a recovery procedure is changed.
- `compliance/policies/09-backup-recovery.md` — the data-recovery half of the BC/DR plan; this policy is the broader scenario.
- `compliance/policies/15-password-authentication.md` — the re-authentication rules that apply during a recovery.
- `compliance/policies/16-third-party-service-provider.md` — the rules for engaging a contract engineer or contract CISO during a §6.6 scenario.
- `compliance/policies/21-encryption-key-management.md` — the key rotation procedure that is the first step in a key compromise recovery.
- `compliance/policies/24-cloud-services-security.md` — the cloud vendor inventory that the §4 scenarios reference.
- `compliance/CONTROL_MATRIX.md` — CC9.1, A.5.29, A.5.30, ISO 27017 A.5.30 evidence rows.
- `compliance/incidents/` — the incident files and the postmortems.
- `compliance/monitoring/` — the quarterly restore test reports.
- `audit_security_migrations_2026-07-30.md` §4.4 — the PITR / SAM2 cold-start gaps this policy closes.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 4h/1h Tier 1 RTO/RPO (matching Policy 09), the seven disaster scenarios, the seven recovery procedures (Neon, Vercel, Render, Cloudflare, GitHub, mass personnel unavailability, security incident), the communication plan (escalation order, message template, status page), the primary/backup ownership table, the quarterly restore test + annual tabletop cadence, and the review-after-every-Sev1 trigger. Closes the CC9.1 Partial row in the 2026-07-30 control matrix. |
