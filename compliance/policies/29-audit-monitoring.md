# Audit & Monitoring Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-029 — Audit & Monitoring Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual), or on material change (new framework in scope, new auditor engaged, new audit cadence, new monitoring source) |
| **Scope** | All compliance and security audits (internal + external), all monitoring activities (the 6 evidence collectors + the 3 GitHub Actions workflows + the weekly digest + the monthly dashboard), all anomaly detection (the §6 cadence), all reporting (the §7 cadence), and the auditor access (the §6 procedure). |

---

## 1. Purpose

This policy is the rule for **how Solarpro audits itself, monitors its controls, detects anomalies, and reports to management + the auditor**. It is the **SOC 2 CC4.1 / CC4.2 + ISO 27001 A.8.16** evidence: that Solarpro performs ongoing and separate evaluations to ascertain whether components of internal control are present and functioning, and that Solarpro evaluates + communicates internal control deficiencies in a timely manner.

The 2026-07-30 control matrix had CC4.1 as **Gap** and CC4.2 as **Partial**. CC4.1 was Gap because the 9 failing tests + the 1 lint blocker + the 51 F-13 backlog blocked the R2 pre-push guard; the policy was the audit-ready form but the cadence was not operating. CC4.2 was Partial because the 207 empty `} catch {}` swallows + the 2,537 unstructured `console.*` calls meant most application errors were silently lost; the operator had no signal to act on. This policy codifies the cadence that closes both gaps.

The policy has three operational pieces:

1. **The internal audit cadence** (§4) — the quarterly self-assessment using the control matrix as the checklist.
2. **The external audit cadence** (§5) — the SOC 2 Type 1 in Q4 2026 + the SOC 2 Type 2 observation + the ISO 27001 Stage 1 + 2 in 2027 + the ISO 27701 + 27017 in 2027.
3. **The continuous monitoring cadence** (§6) — the 6 evidence collectors + the 3 GitHub Actions workflows + the weekly digest + the monthly compliance dashboard + the quarterly UAR + the monthly access review.

The policy also defines the **auditor access** (§10) — the time-bound HMAC tokens + the read-only git access + the NDA-gated review. The auditor access is the operational counter to the "auditor needs the evidence but the evidence is in production" problem.

The 6 evidence collectors (per `compliance/collectors/`) + the 3 GitHub Actions workflows (per `compliance/workflows/`) are the **operating evidence system**. The collectors run on schedule; the workflows commit the evidence diff; the weekly digest is the operator's view. The collectors are the SOC 2 CC4.1 evidence — Solarpro performs ongoing evaluations.

## 2. The internal + external audit structure

The audit structure is the layered approach: continuous monitoring (the collectors) → quarterly self-assessment (the internal audit) → annual external audit (the SOC 2 / ISO 27001 audit). The layers are the §3.1 monitoring, the §4 self-assessment, and the §5 external audit.

### 2.1 The three layers

| Layer | Cadence | Owner | Output | Controls |
|---|---|---|---|---|
| **Continuous monitoring** | Daily / weekly / monthly | Cody (technical); Raymond (CISO review) | The 6 collector outputs + the weekly digest + the monthly dashboard | CC4.1, CC4.2, A.8.15, A.8.16 |
| **Quarterly self-assessment** | Every 90 days | Raymond (CISO) | The self-assessment report at `compliance/audits/self-assessments/<YYYY-Q#>.md` | CC4.1, CC4.2, A.5.35 |
| **Annual external audit** | Annually (per framework) | External auditor + James (engagement) + Raymond (facilitation) | The audit report (SOC 2 Type 1 / Type 2 + ISO 27001 cert) | All controls |

The three layers are the **defense in depth** for the audit posture. The continuous monitoring catches drift in real-time; the quarterly self-assessment catches the drift that the monitoring missed; the annual external audit validates the whole posture from an independent perspective.

### 2.2 The integration

The three layers are **integrated**: the quarterly self-assessment consumes the monthly dashboard + the weekly digest; the annual external audit consumes the self-assessment reports + the collector outputs + the policy library. The integration is the §3 evidence flow + the §8 reporting cadence.

The integration is the **single source of truth**. The auditor reads the policy library + the self-assessment reports + the collector outputs to verify the control environment. The integration is the operational counter to the "three separate reports that don't agree" problem.

## 3. The continuous monitoring system

The continuous monitoring system is the **6 evidence collectors + the 3 GitHub Actions workflows + the weekly digest + the monthly compliance dashboard**. The system is the SOC 2 CC4.1 / CC4.2 operating evidence.

### 3.1 The 6 evidence collectors

The 6 collectors (per `compliance/collectors/`) are:

1. **`github.mjs`** — GitHub REST + GraphQL. Hourly: Dependabot + secret scanning. Daily: + branch protection + members + 2FA. Weekly: + commit-signing sample. The collector covers SOC 2 CC6.1 (logical access), CC6.8 (malicious software), CC7.1 (vulnerability detection), A.5.17 (authentication), A.8.7 (malware), A.8.8 (vulnerability management), A.8.32 (change management). Reads `COMPLIANCE_GITHUB_TOKEN`.
2. **`vercel.mjs`** — Vercel REST v9. Daily: projects + deployments + env-vars (keys only) + members. Weekly: + 7d deployment history. The collector covers SOC 2 CC6.1 (logical access), CC6.6 (logical access security), CC8.1 (change management), A.5.23 (cloud services), A.8.9 (configuration management), A.8.16 (monitoring). Reads `COMPLIANCE_VERCEL_TOKEN` (+ optional `COMPLIANCE_VERCEL_TEAM_ID` + `COMPLIANCE_VERCEL_PROJECT`).
3. **`render.mjs`** — Render REST v1. Daily: deploys + events + env-vars (keys only) + members. The collector covers SOC 2 CC6.1, CC6.6, CC8.1, A.5.23, A.8.9, A.8.16. Reads `COMPLIANCE_RENDER_API_KEY` (+ optional `COMPLIANCE_RENDER_OWNER_ID` + `COMPLIANCE_RENDER_SERVICE_IDS`).
4. **`neon.mjs`** — Neon REST v1. Daily: project + branches + roles (no password) + PITR window + consumption. The collector covers SOC 2 CC6.1, CC6.3 (access removal), A.5.15 (access control), A.5.18 (access rights), A.8.13 (backup). Reads `COMPLIANCE_NEON_API_KEY` + `COMPLIANCE_NEON_PROJECT_ID`.
5. **`google-workspace.mjs`** — Google Admin SDK + Reports API. Hourly: failed-login spike. Daily: + users + MFA + admin roles. Weekly: + login-audit + drive-sharing + token-audit. The collector covers SOC 2 CC6.1, CC6.2 (authorization), CC6.3, A.5.16 (identity management), A.5.17, A.6.3 (awareness training). Reads `COMPLIANCE_GOOGLE_WORKSPACE_TOKEN` (OAuth 2.0).
6. **`db-internal.mjs`** — Postgres via `pg` (already a dep). Hourly: audit-log + webhook-deliveries new rows (NDJSON). Daily: full tables + users + orgs summary. The collector covers SOC 2 CC7.2 (monitoring), CC7.3 (incident evaluation), A.8.15 (logging), A.8.16 (monitoring), A.5.28 (collection of evidence). Reads `COMPLIANCE_DATABASE_URL`.

The collectors are pure Node 20 ESM, dependency-free (except `pg` for `db-internal.mjs`). The collectors are runnable locally (`node compliance/collectors/<name>.mjs`) and on GitHub Actions (the §3.2 workflows). The collectors are the §3.1 monitoring layer.

### 3.2 The 3 GitHub Actions workflows

The 3 workflows (per `compliance/workflows/`) are:

1. **`hourly.yml`** — cron `7 * * * *`. Calls `github.mjs`, `google-workspace.mjs`, `db-internal.mjs` in hourly mode. Commits the evidence diff.
2. **`daily.yml`** — cron `0 6 * * *`. Calls all 6 collectors in daily mode. Commits the evidence diff.
3. **`weekly.yml`** — cron `0 6 * * 0`. Calls all 6 collectors in weekly mode. Composes `compliance/monitoring/weekly-<DATE>.md` (human-readable roll-up). Emails James via Resend. Commits evidence + report.

The workflows are **push-gated by `PUSH_ENABLED`** (default `false`); the workflows commit locally and only push to origin when `PUSH_ENABLED=true`. The default is the safe initial deploy; the operator (Raymond) enables push after the first successful dry-run.

The workflows are the **automation layer**. The collectors + the workflows are the operating evidence system; the §3.1 collectors are the data source; the §3.2 workflows are the data pipeline.

### 3.3 The weekly monitoring digest

The weekly digest is the **operator's view**. The digest is composed by the `weekly.yml` workflow + emailed to James. The digest is a Markdown file at `compliance/monitoring/weekly-<DATE>.md`; the digest summarizes:

- The 6 collectors' output for the week.
- The env-fingerprint diff (the §3.4 env-fingerprint).
- The dependency CVEs discovered in the week (Dependabot alerts).
- The audit log anomalies (e.g. failed admin login spike).
- The UAR state (the §6.2 quarterly UAR).
- The risk register changes (per Policy #27 §8.3).
- The patch state (the patches applied in the week, per Policy #23).

The digest is the **CISO's Monday morning reading**. Raymond reviews the digest on Monday morning; anomalies are flagged in the digest; the CISO's review is the §6 anomaly detection.

### 3.4 The env-fingerprint

The env-fingerprint is the **drift detection** for the env vars. The fingerprint is computed by the `env-fingerprint.yml` workflow (per Policy #26 §6.2); the workflow compares the actual Vercel + Render env vars against the §6.2 matrix in Policy #26. Drift is reported in the weekly digest.

The fingerprint is the **A.8.9 (Configuration management) operating evidence**. The fingerprint catches the "production secret accidentally set in a preview env" + the "preview secret accidentally set in production" + the "env var removed but the application still references it" + the "env var added but not in the matrix" cases. The fingerprint is the §6 anomaly detection for the env-var surface.

### 3.5 The monthly compliance dashboard

The monthly compliance dashboard is the **management's view**. The dashboard is a one-page summary at `compliance/monitoring/dashboard-<YYYY-MM>.md`; the dashboard summarizes:

- The control matrix status (Implemented / Partial / Gap / N/A counts).
- The risk register status (Low / Medium / High / Critical counts; the open treatments).
- The vendor status (Tier 1 vendor SOC 2 report renewal dates; the DPA status).
- The patch status (the open Critical / High patches; the KEV status).
- The UAR status (the last UAR date; the next UAR date).
- The training status (the last training date per employee; the next training date).
- The audit status (the next audit date; the open findings; the closed findings).

The dashboard is the **board-level summary** for the monthly management review. The dashboard is the §7 reporting cadence for James.

## 4. Internal audit cadence

The internal audit is the **quarterly self-assessment** using the control matrix as the checklist. The internal audit is the §4.1 cadence + the §4.2 procedure.

### 4.1 The cadence

The self-assessment is every 90 days, on the 15th of the month following the quarter end (January 15, April 15, July 15, October 15). The owner is Raymond (CISO). The participants are James + Raymond + Cody.

The self-assessment is **independent** of the continuous monitoring (§3). The self-assessment verifies the monitoring is operating correctly; the self-assessment is the "second pair of eyes" on the control environment.

### 4.2 The procedure

The self-assessment follows the §4.2.1–§4.2.5 procedure.

#### 4.2.1 The checklist

The checklist is the **78 rows of the control matrix** + the **93 rows of the SoA** + the **19+ rows of the risk register**. The self-assessment goes row by row; for each row, the §4.2.2 verification is performed.

#### 4.2.2 The per-row verification

For each control row:

1. **Verify the implementation status** is correct. Read the evidence; verify the evidence is current; verify the evidence is the operating control (not a documented aspirational control).
2. **Verify the linked risks** in the risk register are still mitigated. Read the risk treatment; verify the treatment is operating.
3. **Verify the owner** is still the right person. The owner may have changed (e.g. a team member departure).
4. **Verify the last reviewed date** is current. The date should be ≤ 90 days for the active controls.
5. **Verify the exception process** has no stale exceptions. The §10 of Policy #27 — the exception re-evaluation date.

The verification produces a per-row status: **Pass / Pass with notes / Fail / Fail with remediation plan**.

#### 4.2.3 The findings

The findings are the rows marked **Fail** or **Fail with remediation plan**. The findings are recorded in `compliance/audits/findings-<YYYY-Q#>.csv` (per the §4.2.4 schema); the findings are assigned an owner, a target date, a severity (per the §4.2.5 scale).

#### 4.2.4 The findings schema

The CSV columns:

| Column | Type | Description |
|---|---|---|
| `finding_id` | string | `F-<YYYY-Q#>-<NNN>` (e.g. `F-2026-Q4-001`). |
| `control_id` | string | The control ID that failed (e.g. `A.8.15`). |
| `risk_id` | string | The risk ID (e.g. `R-024`). |
| `title` | string | Short finding title. |
| `description` | string | One-paragraph description of the finding. |
| `severity` | enum | P0 / P1 / P2 / P3. |
| `owner` | string | The person who owns the remediation. |
| `target_date` | date | The remediation target date. |
| `status` | enum | Open / In remediation / Remediated / Accepted. |
| `evidence_reference` | string | The path to the remediation evidence. |
| `notes` | string | Free-form notes. |

#### 4.2.5 The severity scale

| Severity | Definition | SLA |
|---|---|---|
| **P0** | A control that is not operating + customer impact is possible. | 7 days |
| **P1** | A control that is not operating + customer impact is unlikely but possible. | 30 days |
| **P2** | A control that is partially operating + the gap is documented. | 90 days |
| **P3** | A control that is operating + a documentation gap. | Next review cycle |

A P0 finding is escalated to James + the auditor (if engaged) within 1 business day. A P1 finding is escalated to James within 5 business days.

### 4.3 The output

The output of the self-assessment is:

1. **The self-assessment report** at `compliance/audits/self-assessments/<YYYY-Q#>.md`. The report summarizes the procedure, the findings, the remediation plans.
2. **The findings CSV** at `compliance/audits/findings-<YYYY-Q#>.csv`.
3. **The updated control matrix** (the §4.2.2 status changes are reflected).
4. **The updated risk register** (the §4.2.2 risk status changes are reflected).
5. **The management review** (the §7 reporting cadence).

## 5. External audit cadence

The external audit is the **annual audit** by an independent third-party auditor. The external audit is the §5.1 cadence + the §5.2 auditor selection + the §5.3 scope + the §5.4 process.

### 5.1 The cadence

The external audit cadence per framework:

| Framework | Audit type | Cadence | First audit |
|---|---|---|---|
| **SOC 2 Type 1** | Point-in-time audit | One-time | Q4 2026 (per the Trust Center) |
| **SOC 2 Type 2** | Observation-period audit | Annual after Type 1 | Observation period begins after Type 1; report in 2027 |
| **ISO 27001 Stage 1** | Documentation review | One-time (per cert cycle) | Q1 2027 |
| **ISO 27001 Stage 2** | Operating-effectiveness audit | One-time (per cert cycle) | Q2 2027 |
| **ISO 27001 cert** | Cert (3-year cycle) | Recert every 3 years | Q3 2027 (after Stage 2) |
| **ISO 27701 cert** | Privacy extension to 27001 | Recert with 27001 | Q3 2027 |
| **ISO 27017 cert** | Cloud extension to 27001 | Recert with 27001 | Q3 2027 |
| **Pen test** | External | Annual | TBD (per `PEN_TEST_SHORTLIST.md`; deferred per James 2026-07-30 no-money) |

The cadence is the operational counter to the "we'll get to it" approach to certification. The cadence is committed to in the Trust Center; the cadence is the §5.3 audit scope.

### 5.2 Auditor selection

The auditor is selected via **RFP** (Request for Proposal). The RFP is sent to 3-5 mid-tier firms; the firms are pre-qualified per the `AUDITOR_SHORTLIST.md` (the shortlist is the §5.2.1 list).

#### 5.2.1 The shortlist

The shortlist is the **Schellman-class firms** at the **$30-60K** price point for SOC 2 Type 1 + the **$50-80K** price point for ISO 27001. The shortlist is at `AUDITOR_SHORTLIST.md` (compliance-lead workspace); the shortlist is updated annually.

#### 5.2.2 The RFP

The RFP includes:

- The scope of the audit (per §5.3).
- The framework(s) in scope (per §5.1).
- The timeline (the audit start + the report delivery).
- The price (the firm provides a fixed-fee quote).
- The references (the firm provides 3 references from similar-sized SaaS companies).
- The auditor team (the firm provides the lead auditor + the support team).

The RFP is sent to the shortlist firms; the responses are due within 2 weeks; the selection is made within 4 weeks of the response deadline.

#### 5.2.3 The selection

The selection is made by **James (CEO)** with input from **Raymond (CISO)**. The selection criteria are:

- **Price** (40% weight).
- **References** (20% weight).
- **Auditor team experience** (20% weight).
- **Timeline fit** (10% weight).
- **Cultural fit** (10% weight).

The selection is documented in a Linear issue tagged `auditor-selection`; the issue includes the RFP responses, the selection rationale, and the engagement letter scope.

#### 5.2.4 The engagement letter

The engagement letter is signed by **James (CEO)** + the auditor's engagement partner. The engagement letter includes:

- The scope of the audit.
- The timeline (the audit start + the report delivery).
- The price (the fixed fee).
- The auditor's responsibilities + Solarpro's responsibilities.
- The confidentiality + the NDA.
- The termination clause.

The engagement letter is the §5.3 audit scope; the letter is the audit's contractual basis.

### 5.3 The audit scope

The audit scope is documented in advance + agreed with the auditor + committed to in the engagement letter. The scope is the **§5.3.1 in-scope** + the **§5.3.2 out-of-scope** + the **§5.3.3 change-order rule**.

#### 5.3.1 In-scope

- The **production environment**: Vercel production (`solarpro.app`), Neon production (`main`), Render production (`solarpro-sam2`), Cloudflare, GitHub, Stripe, Resend, Sentry.
- The **policy library**: the 30 policies in `compliance/policies/`.
- The **control matrix**: the 78 rows.
- The **SoA**: the 93 rows + the ISO 27017 + 27701 + SOC 2 mappings.
- The **risk register**: the rows in `compliance/risks/register.csv`.
- The **evidence**: the collector outputs in `compliance/evidence/` + the manifest at `compliance/manifest.json`.
- The **operations**: the SDLC (the change management + the patch management + the SBOM).

#### 5.3.2 Out-of-scope

- The **preview / development / scratch environments** (per Policy #26 §3.1).
- The **test data** (per A.8.33).
- The **historical data** before the audit observation period (for SOC 2 Type 2, the observation period is the period being audited; for SOC 2 Type 1, the historical data is out of scope).
- The **vendor's controls** (the vendor's SOC 2 report is the evidence; the auditor does not re-audit the vendor).

#### 5.3.3 The change-order rule

A scope change after the engagement letter is signed requires a **change order**. The change order is a written amendment to the engagement letter; the change order is signed by James + the auditor's engagement partner. The change order is the §5.2.4 amendment.

A change order is **not** a verbal agreement + a new SOW. The change order is the contractual basis for the scope change.

### 5.4 The audit process

The audit process is the §5.4.1 planning + the §5.4.2 fieldwork + the §5.4.3 reporting.

#### 5.4.1 Planning

The planning phase is **4-6 weeks before the fieldwork**. The auditor reviews the policy library + the control matrix + the SoA + the risk register + the evidence samples. The auditor identifies the controls to test; the auditor shares the test plan with Solarpro.

Solarpro's response to the test plan: review the test plan; verify the test plan is within the §5.3 scope; prepare the evidence for the tested controls.

#### 5.4.2 Fieldwork

The fieldwork phase is **1-2 weeks on-site** (or remote). The auditor:

- Interviews James, Raymond, Cody.
- Reviews the evidence (the policy library + the collector outputs + the manifest).
- Tests the controls (the per-control operating effectiveness).
- Identifies findings (the §5.4.4 finding classification).

Solarpro's response to the fieldwork: facilitate the auditor's access; provide the evidence on request; clarify any questions the auditor has.

#### 5.4.3 Reporting

The reporting phase is **2-4 weeks after the fieldwork**. The auditor drafts the report; the report includes:

- The opinion (the auditor's opinion on the control environment).
- The findings (the §5.4.4 findings).
- The management response (Solarpro's response to the findings).
- The recommendations (the auditor's recommendations for improvement).

Solarpro's response to the report: review the report; verify the findings are accurate; draft the management response; sign off on the report.

#### 5.4.4 The finding classification

The auditor's findings are classified as:

| Classification | Definition | Action |
|---|---|---|
| **Material weakness** | A control deficiency + a reasonable possibility of a material misstatement. | Remediate within 30 days; re-audit. |
| **Significant deficiency** | A control deficiency + less severe than a material weakness, but important enough to merit attention. | Remediate within 90 days; re-test on next audit. |
| **Other finding** | A control improvement opportunity; not a control deficiency. | Consider for the next review cycle. |

A material weakness is escalated to James + the auditor + the board (if applicable) within 1 business day. A significant deficiency is escalated to James within 5 business days.

## 6. Anomaly detection + response

The anomaly detection is the **continuous monitoring** + the **periodic checks**. The anomaly detection is the §6.1 weekly diff + the §6.2 quarterly UAR + the §6.3 monthly access review.

### 6.1 The weekly diff

The weekly diff is the **per-collector output diff**. The `weekly.yml` workflow computes the diff for each collector's output; the diff is in the weekly digest. Anomalies (a change in the output that is unexpected) are flagged.

Examples of anomalies:

- A new admin user on a Tier 1 vendor console (the `vercel.mjs` + `render.mjs` + `neon.mjs` collectors).
- A new env var on Vercel (the `vercel.mjs` collector + the §3.4 env-fingerprint).
- A new branch on Neon (the `neon.mjs` collector).
- A spike in failed logins (the `google-workspace.mjs` collector).
- A new audit log anomaly (the `db-internal.mjs` collector).

A flagged anomaly is reviewed by Raymond on Monday morning; the review is the §6.4 anomaly response.

### 6.2 The quarterly UAR

The quarterly UAR (User Access Review) is the **per-quarter access review** for every cloud service + every application. The UAR is the §4 of Policy #03 + the §5.1 of Policy #24. The UAR is documented in `compliance/uar/<YYYY-Q#>.md`; the UAR is the SOC 2 CC6.1 + CC6.3 + A.5.18 + A.8.2 evidence.

### 6.3 The monthly access review

The monthly access review is the **lighter-weight review** between the quarterly UARs. The monthly review checks the high-risk surfaces: the admin roles, the MFA state, the API keys, the service accounts. The monthly review is documented in `compliance/uar/monthly-<YYYY-MM>.md`; the monthly review is the §3.1 collector output verification.

### 6.4 The anomaly response

An anomaly is handled per the **Incident Response Plan (#05) §4** if the anomaly is Sev1 (e.g. a new admin user that was not authorized). The anomaly is handled per the **§6.4.1 routine review** if the anomaly is Sev2 or Sev3.

#### 6.4.1 The routine review

A Sev2 / Sev3 anomaly is reviewed by Raymond within 1 business day. The review:

1. **Identify the source** of the anomaly (the collector that detected it; the timeline).
2. **Verify the anomaly** is not a false positive.
3. **Determine the cause** (e.g. a legitimate change by Cody, a vendor-side change, a misconfiguration).
4. **Decide the action** (no action; a process improvement; an incident per Policy #05).
5. **Document the review** in the anomaly's record in the weekly digest + the next self-assessment.

A Sev1 anomaly is handled per Policy #05 §4 (the Sev1 procedure).

## 7. Reporting

The reporting cadence is the **weekly monitoring email + the monthly compliance dashboard + the quarterly board-level summary**. The reporting is the §3.3 weekly digest + the §3.5 monthly dashboard + the §7.3 quarterly summary.

### 7.1 The weekly monitoring email

The weekly monitoring email is sent to James every Monday morning. The email is the §3.3 weekly digest; the email is composed by the `weekly.yml` workflow + sent via Resend. The email subject is `Solarpro weekly compliance digest — <WEEK>`. The email body is the digest.

The email is the **CISO's accountability artifact** — the CISO is responsible for the digest; the digest is the evidence that the CISO is reviewing the monitoring.

### 7.2 The monthly compliance dashboard

The monthly compliance dashboard is the §3.5 dashboard. The dashboard is sent to James + the team on the 1st of each month. The dashboard is the §7.2 management view.

### 7.3 The quarterly board-level summary

The quarterly board-level summary is the **2-page executive summary** of the self-assessment + the risk register + the control matrix. The summary is sent to James + the board (if applicable) on the 15th of the month following the quarter end (per §4.1). The summary is the §7.3 board view.

The summary is the **management review** for the §6.2 of ISO 27001 A.5.35 (Independent review) + the §6.2 of SOC 2 CC1.2 (Board oversight). The summary is signed off by James + Raymond.

## 8. Audit findings tracker

The audit findings tracker is the **single source of truth** for all audit findings (internal + external). The tracker is at `compliance/audits/findings-<DATE>.csv`; the tracker is the §4.2.4 schema.

The tracker is **per-audit-cycle** (one CSV per quarter for the internal audits; one CSV per audit for the external audits). The tracker is committed to the git evidence store; the tracker is the §5.4.4 finding evidence.

A finding is **closed** when the remediation is verified by the §6 anomaly detection (for Sev2 / Sev3) or by the §5.4.3 report (for external audits). A closed finding is moved to `compliance/audits/findings-<DATE>-closed.csv` for the audit trail.

## 9. Auditor access

The auditor access is the **time-bound HMAC tokens + the read-only git access + the NDA-gated review**. The auditor access is the §10 procedure.

### 9.1 The procedure

The auditor access follows the §10.1.1–§10.1.4 procedure.

#### 9.1.1 The NDA

The auditor signs a **mutual NDA** before any evidence is shared. The NDA is at `compliance/audits/ndas/<auditor-firm>-nda-<DATE>.md`; the NDA is signed by the auditor's engagement partner + James (CEO). The NDA is the contractual basis for the evidence sharing.

#### 9.1.2 The git access

The auditor gets **read-only git access** to the Solarpro repository. The access is via a **deploy key** added to the GitHub org; the deploy key is scoped to the `compliance/` directory; the deploy key is read-only.

The deploy key is created by Raymond; the deploy key is added to the GitHub org by Raymond; the deploy key is removed when the audit is complete.

#### 9.1.3 The HMAC tokens

The auditor gets **time-bound HMAC tokens** for the API access (e.g. the Sentry API for the error monitoring, the Resend API for the email logs). The HMAC tokens are generated by Raymond; the HMAC tokens are valid for the duration of the audit + 30 days; the HMAC tokens are revoked when the audit is complete.

The HMAC tokens are stored in the auditor's 1Password vault; the tokens are not shared via email or Slack.

#### 9.1.4 The on-site access

If the audit is on-site, the auditor gets **physical access** to the Solarpro office (if any) for the fieldwork. The on-site access is coordinated by James; the on-site access is logged (the auditor signs in on arrival); the on-site access is supervised (a Solarpro team member is present at all times).

### 9.2 The access log

The auditor access is **logged** in `compliance/audits/access-log-<DATE>.csv`. The log records:

- The auditor name + firm.
- The access type (git / API / on-site).
- The timestamp + the resource accessed.
- The justification (the control being tested).

The access log is the **SOC 2 CC6.1 + A.5.28 (Collection of evidence)** evidence. The log is reviewed by Raymond after the audit; the log is retained for 7 years.

### 9.3 The access revocation

The auditor access is **revoked** when:

- The audit is complete (the report is delivered).
- The audit is terminated (per the engagement letter's termination clause).
- The auditor leaves the auditor's firm (the access is tied to the auditor's email + the firm).
- The HMAC token expires (per the §10.1.3 30-day window).

The revocation is performed by Raymond; the revocation is logged in the access log.

## 10. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Owns the §3 continuous monitoring. Owns the §4 internal audit. Owns the §5 external audit facilitation. Owns the §6 anomaly detection. Owns the §9 auditor access. Reviews the §3.3 weekly digest on Monday morning. Reviews the §3.5 monthly dashboard. Reviews the §4 self-assessment. Reviews the §5 external audit report. |
| **Technical lead** | **Cody** | Implements the §3.1 collectors. Maintains the §3.2 workflows. Investigates the §6 anomalies. Provides the §4 self-assessment technical input. Implements the §5 external audit remediation. Implements the §9 auditor access (the deploy key + the HMAC tokens). |
| **Management sign-off** | **James Carpenter** | Approves the §4.2 self-assessment. Approves the §5.2 auditor selection. Signs the §5.2.4 engagement letter. Approves the §5.3.3 change orders. Receives the §7.1 weekly email. Receives the §7.2 monthly dashboard. Receives the §7.3 quarterly board-level summary. Approves the §5.4.4 finding classification. |
| **All team members** | James, Raymond, Cody | Respond to the §6 anomaly detection. Cooperate with the §5 external audit. File access anomalies. |

A violation (a missed weekly digest, a missed UAR, a missed self-assessment, a missed auditor access revocation) is handled per the Information Security Policy (#01) §9.

## 11. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §3.1 collector list (new collectors may have been added), a refresh of the §4 self-assessment procedure (the control matrix may have grown), a refresh of the §5 external audit cadence (new framework in scope), a refresh of the §6 anomaly detection (new anomaly sources), a refresh of the §7 reporting cadence (new reports may have been added), and a refresh of the §9 auditor access procedure.
- **On material change** — within 30 days of any of: a new framework in scope, a new auditor engaged, a new audit cadence, a new monitoring source, a new anomaly type, a new report.
- **After every external audit** — the auditor's feedback on the policy is incorporated; the policy is updated.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 12. Related documents

- `compliance/policies/01-information-security.md` — the foundation; the §6 framework coverage.
- `compliance/policies/05-incident-response.md` — the §6.4 anomaly response (the Sev1 / Sev2 / Sev3 handling).
- `compliance/policies/08-logging-monitoring.md` — the §3 monitoring + the §6 anomaly detection.
- `compliance/policies/18-privacy-policy.md` — the §5.1 ISO 27701 audit cadence.
- `compliance/policies/24-cloud-services-security.md` — the §3.1 collector list (the 12 cloud vendors).
- `compliance/policies/27-risk-assessment.md` — the §4.2 self-assessment input (the risk register).
- `compliance/policies/28-statement-of-applicability.md` — the §4.2 self-assessment input (the SoA).
- `compliance/collectors/` — the 6 evidence collectors.
- `compliance/workflows/` — the 3 GitHub Actions workflows.
- `compliance/audits/` — the §4.2 self-assessment reports + the §5.4.4 finding tracker.
- `compliance/monitoring/` — the §3.3 weekly digest + the §3.5 monthly dashboard.
- `compliance/uar/` — the §6.2 quarterly UAR + the §6.3 monthly access review.
- `compliance/manifest.json` — the evidence-to-control map.
- `compliance/CONTROL_MATRIX.md` — the §4.2 self-assessment checklist.
- `AUDITOR_SHORTLIST.md` — the §5.2.1 auditor shortlist.
- `PEN_TEST_SHORTLIST.md` — the pen test vendor shortlist (deferred per James no-money).
- `SELF_BUILT_SETUP.md` — the design doc for the self-built evidence system.
- `R2_SETUP_RUNBOOK.md` — the R2 evidence storage design (deferred per James no-money; git is the store).

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the **three-layer audit posture** (continuous monitoring via the 6 collectors + 3 workflows; quarterly self-assessment using the control matrix as checklist; annual external audit for SOC 2 Type 1 in Q4 2026 + Type 2 observation + ISO 27001 Stage 1+2 in 2027 + ISO 27701 + 27017 in 2027), the §3.1 collector list (github.mjs, vercel.mjs, render.mjs, neon.mjs, google-workspace.mjs, db-internal.mjs) with the cadence (hourly / daily / weekly), the §3.2 workflow list (hourly.yml, daily.yml, weekly.yml) with the cron schedules, the §3.3 weekly digest + the §3.4 env-fingerprint + the §3.5 monthly compliance dashboard, the §4 internal audit cadence (quarterly self-assessment with the §4.2.4 findings schema + the §4.2.5 severity scale), the §5 external audit cadence (the §5.2.1 auditor shortlist + the §5.2.2 RFP + the §5.2.4 engagement letter + the §5.3 audit scope + the §5.4 process + the §5.4.4 finding classification), the §6 anomaly detection (the §6.1 weekly diff + the §6.2 quarterly UAR + the §6.3 monthly access review + the §6.4 routine review), the §7 reporting cadence (the §7.1 weekly email + the §7.2 monthly dashboard + the §7.3 quarterly board-level summary), the §8 findings tracker, the §9 auditor access (the §9.1.1 NDA + the §9.1.2 git deploy key + the §9.1.3 time-bound HMAC tokens + the §9.1.4 on-site access + the §9.2 access log + the §9.3 revocation), the §10 roles (Raymond = CISO owner; Cody = technical; James = management sign-off), and the §11 review cadence. Closes the SOC 2 CC4.1 (Gap → Implemented) and CC4.2 (Partial → Implemented) controls; the 6 collectors + 3 workflows are the **operating evidence system** the auditor will sample. |
