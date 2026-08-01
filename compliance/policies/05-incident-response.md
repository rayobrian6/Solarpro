# Incident Response Plan

| Field | Value |
|---|---|
| **Policy** | POL-OP-002 — Incident Response Plan |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or after any Sev1 incident |
| **Scope** | All Solarpro systems, employees, contractors, and customer-facing services. Every suspected or confirmed security event. |

---

## 1. Purpose

This plan is what you do when something goes wrong. It defines what counts as a security incident, who does what, how you respond, and how you learn from it. It's the **SOC 2 CC7.3 / CC7.4 / CC7.5 + ISO 27001 A.5.24 / A.5.25 / A.5.26 / A.5.27 / A.5.28 / A.5.29** evidence.

The plan is **NIST 800-61 aligned** (Detect → Contain → Eradicate → Recover → Learn), adapted for a 3-person team that does not have a 24/7 SOC.

## 2. Definition of a security incident

A security incident is any confirmed or suspected event that compromises, or could compromise, the confidentiality, integrity, availability, or privacy of Solarpro systems or data. Examples:

- Unauthorized access to a Solarpro account, system, or dataset.
- Exposure of credentials (API keys, JWT secrets, OAuth tokens, database URLs) in source code, logs, or to an unauthorized party.
- Loss or theft of a device that contains Solarpro data or has access to Solarpro systems.
- A customer-facing data exposure (PII leak, misconfigured S3/R2 bucket, inadvertent inclusion of customer data in a non-production environment).
- A confirmed compromise of a sub-processor handling Solarpro data (e.g. a vendor breach that affects Solarpro data).
- A suspected phishing, social engineering, or credential-stuffing attempt that targeted a Solarpro account.
- A rate limiter, vision API, or other third-party service failing in a way that creates a security or data integrity gap (e.g. the 2026-08-12 rate-limiter fail-open incident).
- A migration governance breach (e.g. a migration ran without one of the four required gates).
- Any event the auditor would expect to see documented.

### 2.1 Severity classification

| Severity | Definition | Examples | First-response SLA |
|---|---|---|---|
| **Sev1** | Confirmed (or near-certain) breach of Restricted data. Active exploitation in progress. Production outage with customer impact. | PII exposed externally. Production database accessed by an unauthorized party. Stripe key leak. Customer-facing outage. | **Within 1 hour** of detection. James is paged. |
| **Sev2** | Confirmed compromise of a non-Restricted system, credential, or account. Limited or no customer impact. | An admin account's password is suspected compromised but MFA held. An internal service is exploited but contained. Non-production data exposure. A failed sub-processor security control that affects Solarpro. | **Within 4 business hours**. James notified. |
| **Sev3** | Suspected event with no evidence of compromise. Policy violation, near-miss, security control gap detected. | A phishing email reported. A 178/293 route rate-limit gap is identified (already known — P0). An unusual Sentry error pattern. | **Within 1 business day**. Logged. |

When in doubt, classify up.

## 3. Roles

| Role | Person | Responsibilities |
|---|---|---|
| **Incident Commander (IC)** | **Raymond O'Brien** (CISO) | Owns the incident end-to-end. Decides severity. Calls the response phases. Coordinates communication. Signs the PIR. |
| **Management sign-off** | **James Carpenter** (CEO) | Approves external communications, customer notifications, regulator notifications, and any decision with material cost or legal exposure. Backup IC if Raymond is unreachable. |
| **Technical lead** | **Cody** | Implements containment, eradication, and recovery under the IC's direction. Runs queries, rolls back deploys, rotates secrets. |
| **Communications** | **James** (default) | Owns customer-facing, regulator-facing, and public statements. The IC drafts; James approves. |

If a role is vacant, the next-most-senior person covers. A 3-person team has no redundant coverage; the goal is to keep the IC role filled and to pull in external help (compliance-lead agent, contracted incident-response firm) for Sev1.

## 4. Response phases

The phases follow NIST 800-61. Each phase has a documented output.

### 4.1 Detect

Sources of detection:

- **Automated**: Sentry alerts, Dependabot security PRs, GitHub secret-scanning alerts, the weekly monitoring digest at `compliance/monitoring/`, UAR findings, Upstash Redis error rate spikes, Stripe webhook signature failures, Neon PITR restore events.
- **User-reported**: an employee or customer reports an issue. Channel: `security@solarpro.app` or direct contact to Raymond.
- **External**: a researcher, a customer, a vendor, or the press. The 24-hour acknowledgment SLA in the Acceptable Use Policy §9 applies.

The first responder (whoever notices) creates an incident file at `compliance/incidents/YYYY-MM-DD-<slug>.md` with: timestamp, reporter, suspected severity, what happened, what is known. The IC confirms the severity within the SLA in §2.1.

### 4.2 Contain

Goal: stop the bleeding without yet destroying evidence.

- **Short-term containment** (within hours): revoke access, rotate credentials, block IPs, roll back a deploy, take a system offline, suspend a user account.
- **Systemic containment** (within the same business day): deploy a fix to a control, push a hotfix, change a configuration, isolate a network segment.

Every containment action is logged in the incident file with timestamp, actor, and reason. The IC is the only one who approves destructive actions (deletes, drops, purges) during containment; everything else is delegated to the technical lead.

### 4.3 Eradicate

Goal: remove the attacker's foothold and the root cause.

- Patch the vulnerability, not just the symptom. The 2026-08-12 rate-limiter fail-open was contained by adding an in-memory LRU fallback; eradication meant the gate was added to the 178 routes that were missing it and `checkRateLimit()` became required at the API layer.
- Rotate any credential that was exposed, even if rotation was already done during containment.
- Audit for lateral movement: who else accessed the system, what other systems share the credential, what data was touched.
- The output is a one-paragraph "root cause" in the incident file.

### 4.4 Recover

Goal: restore service to normal operation, with confidence that the issue is not coming back.

- Restore from clean backups if data integrity is in question. Neon PITR is the primary restore path; the restore itself is logged in `auditLog.ts`.
- Re-enable disabled systems one at a time, with monitoring elevated for 72 hours.
- Verify the fix in production (not just staging) before declaring recovery complete.
- Communicate status to affected customers (Sev1 only) with a clear timeline and remediation.

### 4.5 Learn (Post-Incident Review)

Every Sev1 and Sev2 incident has a **Post-Incident Review (PIR)** within **5 business days** of recovery. The PIR is a markdown file at `compliance/incidents/YYYY-MM-DD-<slug>-PIR.md` with:

1. **Summary** — 2-3 sentences for an executive reader.
2. **Timeline** — UTC timestamps for: detection, IC assignment, containment, eradication, recovery, customer notification, regulator notification (if any).
3. **Root cause** — what actually happened, not just the symptom.
4. **What worked** — controls and decisions that held.
5. **What didn't** — gaps in detection, response, or recovery.
6. **Action items** — each with an owner, a target date, and a control reference (e.g. CC7.2, A.8.15). Action items become Linear issues.
7. **Lessons** — 1-3 sentences the next person on call should know.

Sev3 incidents get a one-paragraph note in the same incidents folder and are aggregated in the next quarterly UAR.

The PIR is signed off by Raymond (as IC) and James (as management).

## 5. Specific scenarios

These are the scenarios most likely to occur at Solarpro given the current stack. Each is a worked example of the phases.

### 5.1 Rate limiter outage (recurring)

**What it looks like**: Upstash Redis is unavailable. Without a fallback, every gated route allows. Alternatively, 178/293 routes have no `checkRateLimit()` at all.

**Detect**: 5xx spike in API gateway; abuse signal from Stripe webhook retries; Sentry alert.

**Contain**: in-memory LRU fallback (already deployed as of 2026-08-12) takes over; affected routes serve from the fallback bucket. If fallback is also unavailable, Raymond decides per-route: block public traffic, allow authenticated only, or take the service down.

**Eradicate**: root-cause the Redis issue (network, quota, misconfig). Add the missing `checkRateLimit()` calls. Add a per-route test that asserts the gate is present.

**Recover**: validate rate-limit metrics for 24h; close the incident.

**Learn**: PIR documents the failure mode. Action items: weekly Redis health check, Sentry alert on the fallback path.

### 5.2 Vision fail-silent

**What it looks like**: OpenAI or Anthropic API key is missing or rate-limited. The plan-set generator falls back to a "vision not available" path. Aerial photos contribute zero to the engineering output. The customer receives a planset that looks normal but is materially less accurate.

**Detect**: `MAX_DAILY_COST_USD` or `VISION_DAILY_BUDGET_USD` alert; Sentry error pattern; customer complaint about plan accuracy.

**Contain**: disable the plan-set generator for new surveys until the vision path is verified. Notify affected customers that their plan-set may need re-generation.

**Eradicate**: restore the API key, fix the env-var gate, add a fail-loud banner when the vision path is unavailable (already in flight per `audit_solar_ml` §2 #4). Add an adversarial test for the "vision disabled" code path.

**Recover**: re-generate the affected plan-sets; refund or credit per the customer agreement.

**Learn**: PIR covers the customer impact and the controls gap. The `MAX_DAILY_COST_USD` cap is the priority action item.

### 5.3 Migration governance breach

**What it looks like**: a database migration runs without satisfying the four required gates (advisory lock, checksum, ledger entry, `TARGETED_RECOVERY_ALLOWLIST`). The `analyzeRegistryMigration` static analysis should catch it; if it doesn't, the migration ran.

**Detect**: `MIGRATION-GOV-13` audit log; UAR review; static analysis failure in CI.

**Contain**: lock the registry; identify the migration that ran; check the database for schema drift.

**Eradicate**: roll back the migration if reversible. If not, snapshot the current state via Neon PITR and plan a forward-fix migration. Update the static analysis to catch the bypass.

**Recover**: re-run the four-gate validation on the corrected registry; close the incident.

**Learn**: PIR. Action items: harden the static analysis, add a CI gate that fails the build on any unaccounted migration.

### 5.4 Credential leak

**What it looks like**: a secret is committed to source code, posted in Slack, exposed in a Sentry event, or discovered in a public repo.

**Detect**: GitHub secret-scanning alert (the highest-signal source); user report; Sentry event payload inspection.

**Contain**: rotate the credential **immediately**, before any other action. The old credential is treated as compromised regardless of intent.

**Eradicate**: remove the secret from git history (BFG Repo-Cleaner or `git filter-repo`). Audit access logs for any use of the old credential between leak and rotation. Add a pre-commit hook (`gitleaks` or equivalent) if not present.

**Recover**: deploy the new credential. Verify the application is operating normally.

**Learn**: PIR. Action items: secret-rotation cadence, pre-commit hook rollout, training on the Acceptable Use Policy §5.

### 5.5 Data breach (PII exposure)

**What it looks like**: customer PII (homeowner, inspector) is accessible to an unauthorized party — through a misconfigured R2 bucket, a leaked database backup, an SQL injection, an exposed admin endpoint.

**Detect**: customer report, security researcher, internal audit, Sentry, Dependabot (for the underlying CVE).

**Contain**: revoke the access path (close the bucket, take the endpoint offline, rotate the database credentials). Preserve evidence (snapshots, logs) before any destructive recovery.

**Eradicate**: patch the vulnerability, not just the symptom. Audit for any access that already occurred.

**Recover**: bring the system back online with the fix in place. Communicate to affected customers (per the Data Classification & Handling Policy §2.4).

**Notify (GDPR / CCPA)**:

- **Supervisory authority**: within **72 hours** of becoming aware of the breach, if the breach is likely to result in a risk to the rights and freedoms of data subjects. The 72-hour clock starts at the moment the IC confirms the breach, not at detection.
- **Data subjects**: "without undue delay" if the breach is likely to result in a high risk to their rights. Typically within 30 days.
- **Auditor**: at the next scheduled audit. Sev1 breaches are disclosed in the SOC 2 report's incident section.
- James owns regulator and customer notifications. The IC drafts.

**Learn**: PIR. Action items depend on root cause; common ones are: input validation hardening, WAF rule additions, customer-facing security advisory.

## 6. Reporting

| Recipient | When | Owner | Channel |
|---|---|---|---|
| **All employees** | Sev1 within 4 hours; Sev2 within 1 business day | Raymond | Slack `#security` channel |
| **James** (CEO) | All Sev1, all Sev2, weekly Sev3 summary | IC | Direct message |
| **Affected customers** | Sev1 with PII or service impact, within regulatory windows | James | Email + Trust Center status |
| **Regulators** | GDPR Art. 33 (72h supervisory authority), Art. 34 (data subject if high risk), state breach laws as applicable | James | As required |
| **Auditor** | At the next audit + immediate disclosure if it changes the SOC 2 opinion | James + compliance-lead | Through the auditor-access flow |
| **Public / press** | Only if required by law or material reputational risk | James | Coordinated with legal counsel |

## 7. Evidence and chain of custody

Every incident generates evidence: `auditLog.ts` rows, Sentry events, Vercel/Render/Neon logs, Slack screenshots, the incident file itself. The evidence is preserved for **7 years** (consistent with the audit log retention in the Data Classification & Handling Policy §6.1).

Chain of custody:

- The incident file is the authoritative log. Every action (containment, rotation, communication) is timestamped and attributed.
- Sentry, audit log, and infra logs are append-only and content-addressed in R2.
- External evidence (vendor statements, customer reports) is stored in the incident folder with the original message + sender + timestamp.

## 8. Testing and drills

The plan is tested **annually** with a tabletop exercise. Raymond designs a scenario (e.g. "the production database credentials leaked to a public Slack channel"), James and Cody walk through the phases, and the gaps are documented as action items. The exercise output is itself an evidence artifact filed at `compliance/incidents/<date>-tabletop.md`.

In addition, the **weekly monitoring digest** and **quarterly UAR** are continuous low-stakes rehearsals of the Detect and Learn phases.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation.
- `compliance/policies/03-access-control.md` — credential lifecycle, offboarding.
- `compliance/policies/04-data-classification-handling.md` — PII handling, breach notification windows.
- `compliance/incidents/` — incident files and PIRs.
- `compliance/monitoring/` — weekly monitoring digest.
- `compliance/uar/` — quarterly user access reviews.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the Sev1/Sev2/Sev3 taxonomy and the 5-business-day PIR SLA. Worked examples cover the rate-limiter, vision fail-silent, migration governance, credential leak, and PII data breach scenarios. |
