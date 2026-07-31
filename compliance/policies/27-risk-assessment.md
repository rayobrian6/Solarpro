# Risk Assessment Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-027 — Risk Assessment Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual), quarterly review per §8.3, ad-hoc review after every Sev1 incident per §8.5, annual comprehensive reassessment per §8.6 |
| **Scope** | Every risk to the achievement of Solarpro's security, availability, processing integrity, confidentiality, and privacy objectives. The scope includes Solarpro's own operations, the 12 cloud services in the vendor inventory, the customer PII lifecycle, the SDLC, the change management process, the access management process, the incident response process, the business continuity / disaster recovery process, and the compliance / audit process. Out of scope: risks entirely outside Solarpro's control (e.g. a global Vercel outage) are tracked for situational awareness but are not formally assessed. |

---

## 1. Purpose

This policy is the rule for **how Solarpro identifies, assesses, treats, monitors, and reviews risk**. It is the **SOC 2 CC3.1 / CC3.2 / CC3.4 + ISO 27001 A.5.7** evidence: that Solarpro has a defined risk management methodology, a maintained risk register, a documented treatment for each risk, and a defined cadence for review.

Solarpro is a 3-person team running a cloud-only SaaS application. The risk surface is dominated by (a) the cloud-vendor concentration (Vercel + Neon + Render + Cloudflare; 4 single points of failure), (b) the customer PII lifecycle (survey photos, homeowner names, addresses, inspector data), and (c) the dependency chain (Next.js, React, the OpenAI / Anthropic / Google Solar APIs, the Stripe / Resend integrations). The risk register is the canonical record of the risks in each of these surfaces and the treatments for them.

The 2026-07-30 control matrix already functions as a **risk register** — the 19-row risk register at the bottom of the matrix is the inherited risk artifact (each row is a risk, with likelihood / impact / inherent risk / residual risk / linked controls). This policy formalizes the register as a **standalone, living artifact** at `compliance/risks/register.csv` and defines the methodology, the cadence, the roles, and the review process around it.

The policy also closes the SOC 2 CC3.1 / CC3.2 / CC3.4 control set explicitly. The 2026-07-30 control matrix had CC3.1 / CC3.2 / CC3.4 as Implemented (with the four 2026-07-30 audit reports as the evidence). The 2026-07-30 row CC3.3 (fraud risk) was Partial; the §3.5 fraud-risk sub-section addresses that. The 2026-07-30 row A.5.7 (Threat intelligence) was Partial; the §3.3 threat-intel sub-section addresses that.

## 2. Risk assessment methodology

The methodology is a **likelihood × impact** scoring model. Each risk is scored on two axes; the product is the **inherent risk score** (before treatment). After the treatment is applied, the residual risk score is recalculated. The difference between the inherent and the residual is the **control effectiveness**.

### 2.1 Likelihood

The likelihood is the probability that the risk materializes within the next 12 months. The scale is 1-5.

| Score | Likelihood | Description | Annual probability |
|---|---|---|---|
| 1 | **Rare** | The risk is theoretical; no precedent in the last 12 months; no known exploit; requires unusual conditions. | < 5% |
| 2 | **Unlikely** | The risk has a precedent in the last 12 months (either at Solarpro or a peer company) but no active exploit; requires some conditions. | 5-25% |
| 3 | **Possible** | The risk is actively discussed in threat-intel feeds; the conditions are present; an exploit is feasible. | 25-50% |
| 4 | **Likely** | The risk has materialized in the last 12 months (either at Solarpro or a widely-reported incident at a peer); an exploit is in the wild. | 50-75% |
| 5 | **Almost certain** | The risk is happening now; an exploit is active; the conditions are certain. | > 75% |

The likelihood is **calibrated to Solarpro's specific situation**, not a generic scoring. A risk that is "Likely" for a cloud SaaS company (e.g. a credential-stuffing attack) might be "Rare" for a desktop application; the calibration is per the §3 risk identification sources.

### 2.2 Impact

The impact is the consequence if the risk materializes. The scale is 1-5. The impact is scored on the **worst-case outcome** within the next 12 months, not the average.

| Score | Impact | Description | Customer impact | Financial impact | Compliance impact |
|---|---|---|---|---|---|
| 1 | **Negligible** | The risk materializes as a minor incident; no customer impact; no compliance exposure. | None | < $1K | None |
| 2 | **Minor** | The risk materializes as a small incident; a small number of customers are affected; the issue is resolved within 24 hours. | < 10 customers | $1K-10K | Single framework minor finding |
| 3 | **Moderate** | The risk materializes as a moderate incident; a significant number of customers are affected; the issue takes 1-7 days to resolve; the SOC 2 / ISO 27001 audit timeline is at risk. | 10-100 customers | $10K-100K | Single framework major finding; one framework's audit at risk |
| 4 | **Major** | The risk materializes as a major incident; most customers are affected; the issue takes 1-4 weeks to resolve; the SOC 2 / ISO 27001 certification is at risk; the regulatory exposure is real (GDPR Art. 33 breach notification, state breach notification). | All customers | $100K-1M | Multiple framework major findings; cert at risk; regulatory exposure |
| 5 | **Severe** | The risk materializes as a catastrophic incident; the company cannot continue to operate; the regulatory exposure is severe (GDPR fine, state AG investigation, class action); the customer trust is destroyed. | All customers + future customers | > $1M | Multiple framework cert loss; regulatory fines; class action |

### 2.3 Inherent risk

The inherent risk is the product of the likelihood and the impact. The product is on a 1-25 scale; the banding is:

| Band | Score | Color | Action |
|---|---|---|---|
| **Low** | 1-4 | Green | Accept; document the rationale; review at the §8.6 annual reassessment. |
| **Medium** | 5-9 | Yellow | Treat; assign a remediation plan with an owner and a target date; review at the §8.3 quarterly review. |
| **High** | 10-15 | Orange | Treat urgently; assign a remediation plan with a 30-day target; report to James; review at the §8.3 quarterly review + the §8.5 ad-hoc review. |
| **Critical** | 16-25 | Red | Treat immediately; assign a remediation plan with a 7-day target; report to James + the auditor (if engaged); review at the §8.3 quarterly review + the §8.5 ad-hoc review + the §8.6 annual reassessment. |

The band drives the §6 treatment; the band drives the §8 review cadence.

### 2.4 Residual risk

The residual risk is the product of the (post-treatment) likelihood and the (post-treatment) impact. The residual risk is recalculated when the treatment is applied. The difference between the inherent and the residual is the control effectiveness.

The control effectiveness is graded:

- **Effective** — residual risk is in the Low band (1-4).
- **Partially effective** — residual risk is in the Medium band (5-9) and the inherent risk was High or Critical.
- **Ineffective** — residual risk is in the High or Critical band (10-25); the treatment failed and the risk needs to be re-treated.

A control marked **Ineffective** is escalated to James + the auditor (if engaged) within 1 business day.

## 3. Risk categories

Risks are categorized to make the register scannable and to ensure the assessment covers the full surface. The categories are not mutually exclusive; a single risk can appear in multiple categories.

### 3.1 Strategic

Risks to Solarpro's strategic objectives: market position, product roadmap, customer trust, investor confidence. Examples:

- A high-profile customer churns after a security incident.
- A competitor launches a feature that obsoletes a Solarpro feature.
- A regulator publishes new guidance that changes the compliance scope.

The strategic risks are reviewed by James in the §8.3 quarterly review.

### 3.2 Operational

Risks to Solarpro's day-to-day operations: the cloud-vendor stack, the SDLC, the on-call coverage, the deployment cadence. Examples:

- A Vercel platform outage prevents customer access.
- A Neon database failure causes data loss.
- A Render service cold-start exceeds the latency budget.
- A team member is unavailable for an extended period (illness, vacation, departure).

The operational risks are reviewed by Raymond in the §8.3 quarterly review.

### 3.3 Financial

Risks to Solarpro's financial position: cost overruns, vendor pricing changes, currency exposure, fraud. Examples:

- A vision API cost overrun burns the monthly budget (per Policy #24 §7.5; the 2026-07-30 control matrix P0 #10).
- A vendor raises prices above the budgeted amount.
- A fraudulent Stripe charge triggers a chargeback fee.

The financial risks are reviewed by James in the §8.3 quarterly review.

### 3.4 Compliance

Risks to Solarpro's compliance posture: SOC 2 / ISO 27001 / 27701 / 27017 audit findings, regulatory exposure, contractual commitments. Examples:

- An auditor finds a P0 control gap during a SOC 2 Type 1 audit.
- A new framework (e.g. FIPS 140-3 for a federal customer) is added to the scope.
- A GDPR Art. 33 breach notification is required within 72 hours.

The compliance risks are reviewed by Raymond + James in the §8.3 quarterly review.

### 3.5 Reputational

Risks to Solarpro's reputation: customer trust, media coverage, social media sentiment, security researcher disclosures. Examples:

- A security researcher publishes a Solarpro CVE on Twitter.
- A customer posts a negative review citing a security incident.
- A data breach is reported in the press.

The reputational risks are reviewed by James in the §8.3 quarterly review.

### 3.6 Technical

Risks to Solarpro's technical posture: vulnerabilities, dependencies, code quality, infrastructure, configuration drift. Examples:

- A high-severity CVE is published for a Solarpro dependency (per Policy #23).
- A code change introduces a regression (the 2026-07-30 control matrix CC8.1 Gap).
- An env var is misconfigured in production (the 2026-07-30 control matrix P0 #2 NODE_ENV-as-Secure).

The technical risks are reviewed by Cody + Raymond in the §8.3 quarterly review.

### 3.7 Third-party

Risks arising from Solarpro's third-party relationships: cloud vendors, ML vendors, payment vendors, contractors. Examples:

- A cloud vendor suffers a security incident.
- A vendor raises prices above the budgeted amount.
- A contractor is terminated and their access is not revoked within 24 hours (per Policy #12 §6 SLA).

The third-party risks are reviewed by Raymond in the §8.3 quarterly review. The 12-vendor inventory in `compliance/vendors.csv` is the input.

### 3.8 Threat intelligence (A.5.7)

The 2026-07-30 control matrix row A.5.7 (Threat intelligence) was Partial. The §3 risk identification sources in §4 below include the threat-intel feeds; the 2026-07-30 A.5.7 finding is closed by the §4.4 feed subscriptions + the §6.1 treatment of the feed signal.

The threat-intel feeds are:

- **GitHub Dependabot security updates** — real-time, via the GitHub Security Advisories database. Subscription: enabled in `.github/dependabot.yml`; the daily workflow per Policy #23 §4.1.
- **CISA Known Exploited Vulnerabilities (KEV) catalog** — daily digest. Subscription: enabled via the CISA RSS feed; the daily workflow per Policy #23 §4.1.
- **NVD CVE feed** — daily digest. Subscription: enabled via the NVD RSS feed; the weekly workflow per Policy #23 §4.1.
- **Vendor security advisories** — Vercel, Neon, Render, Cloudflare, OpenAI, Anthropic, Stripe, Resend, GitHub, GCP. Subscription: vendor-specific RSS / email; the monthly review per Policy #24 §5.2.
- **Security researcher disclosures** — HackerOne, Bugcrowd, direct email to `security@solarpro.app`. The `security@solarpro.app` inbox is monitored by Raymond daily.

## 4. Risk identification sources

Risks are identified from six sources. Each source contributes to the register on a defined cadence.

### 4.1 Audit findings

**Source**: the four 2026-07-30 audit reports (`C:\Users\carpe\.mavis\v2\assets\audit_*_2026-07-30.md`) + any future audit / pen test / internal review reports. **Cadence**: continuous (the audit reports are the seed for the register; future reports add rows on publication). **Owner**: Raymond (CISO). **The 19 risk register rows in the 2026-07-30 control matrix are the seed for `compliance/risks/register.csv`.**

### 4.2 Incident reports

**Source**: the incidents recorded in `compliance/incidents/` per Policy #05 + the Sentry events per Policy #08. **Cadence**: every Sev1 / Sev2 / Sev3 incident adds a row to the register (or updates an existing row) within 5 business days. **Owner**: Raymond (CISO) for Sev1; Cody for Sev2 / Sev3.

### 4.3 Vendor reviews

**Source**: the vendor reviews per Policy #10 §4 + the §5.4 annual vendor security review. **Cadence**: every vendor review adds or updates a row in the register. **Owner**: Raymond (CISO). The 12-vendor inventory is the input.

### 4.4 Threat intelligence

**Source**: the threat-intel feeds in §3.8 above. **Cadence**: weekly digest; the digest adds rows to the register for any CVE that affects a Solarpro dependency. **Owner**: Cody (technical lead) for the technical risks; Raymond (CISO) for the strategic / compliance risks.

### 4.5 Regulatory changes

**Source**: the regulatory monitoring per Policy #01 §6. **Cadence**: ad-hoc (on publication of a new regulation or guidance that affects Solarpro's scope). **Owner**: Raymond (CISO). The 2026-07-30 control matrix's "What's NOT in the matrix" section lists the not-assessed areas that may close when regulations change.

### 4.6 Customer feedback

**Source**: the customer feedback in the Trust Center `compliance/trust.json` + the customer support tickets + the security disclosures to `security@solarpro.app`. **Cadence**: weekly digest; the digest adds or updates rows for any customer-flagged issue. **Owner**: James (CEO) for commercial feedback; Raymond (CISO) for security feedback.

## 5. The risk register

The risk register is the canonical artifact. The register is at `compliance/risks/register.csv`; this section is the schema.

### 5.1 The register schema

The CSV columns:

| Column | Type | Description |
|---|---|---|
| `risk_id` | string | Unique risk identifier; format `R-<NNN>` (e.g. `R-001`). |
| `title` | string | Short risk title; the row's primary identifier. |
| `description` | string | One-paragraph description; what is the risk, how does it materialize. |
| `category` | enum | One of: strategic, operational, financial, compliance, reputational, technical, third-party. |
| `likelihood_inherent` | integer 1-5 | The §2.1 likelihood score, before treatment. |
| `impact_inherent` | integer 1-5 | The §2.2 impact score, before treatment. |
| `risk_inherent` | integer 1-25 | The product; the §2.3 inherent risk score. |
| `band_inherent` | enum | Low / Medium / High / Critical; the §2.3 band. |
| `treatment` | enum | One of: mitigate, transfer, accept, avoid. Per §6. |
| `treatment_description` | string | The specific treatment (e.g. "rotate JWT secret annually; enforce 32-char minimum at runtime"). |
| `linked_controls` | string | Comma-separated control IDs (e.g. `A.5.15, A.8.21, CC6.6`). |
| `likelihood_residual` | integer 1-5 | The post-treatment likelihood. |
| `impact_residual` | integer 1-5 | The post-treatment impact. |
| `risk_residual` | integer 1-25 | The post-treatment risk score. |
| `band_residual` | enum | Low / Medium / High / Critical. |
| `effectiveness` | enum | Effective / Partially effective / Ineffective. |
| `owner` | string | The risk owner; one of James, Raymond, Cody per §7. |
| `target_date` | date | The treatment target date; for High / Critical risks, ≤ 30 days. |
| `status` | enum | Open / In treatment / Treated / Accepted / Closed. |
| `last_reviewed` | date | The date the row was last reviewed. |
| `evidence_reference` | string | The file path or `compliance/manifest.json` path to the evidence. |
| `notes` | string | Free-form notes. |

### 5.2 The seed rows

The seed rows are the 19 risk register rows from the 2026-07-30 control matrix + the new risks identified during the policy drafting. The 2026-07-30 rows are imported as-is (the likelihood / impact / inherent / residual scores from the matrix are preserved); the new risks are added with the §2 scoring methodology applied. The full seed list is at `compliance/risks/register.csv`; the §11 review cadence keeps the register current.

The new risks added by this policy include:

- **R-020**: GDPR Art. 33 breach notification within 72 hours not currently in a runbook. Inherent: 4 × 4 = 16 (Critical). Treatment: write the runbook (per Policy #05 §5.5 + the 2026-07-30 control matrix A.5.34 P0). Owner: Raymond. Target: 2026-09-15.
- **R-021**: PII redaction before transit to third-party vision APIs not implemented. Inherent: 4 × 4 = 16 (Critical). Treatment: implement the EXIF strip (per Policy #18 §6 + the 2026-07-30 control matrix ISO 27701 6.5.x P0). Owner: Cody. Target: 2026-09-30.
- **R-022**: rate-limiter fail-open on Upstash Redis error (per Policy #06 + the 2026-07-30 control matrix CC6.6 P0 #1). Inherent: 5 × 4 = 20 (Critical). Treatment: in-memory LRU fallback. **Closed by the 2026-07-30 security quickwins PR (`fix/rate-limiter-fail-closed`)**; residual 2 × 3 = 6 (Medium).
- **R-023**: NODE_ENV used as Secure cookie gate in 8+ auth code paths (per the 2026-07-30 control matrix CC6.6 P0 #2). Inherent: 3 × 4 = 12 (High). Treatment: VERCEL_ENV migration. **Closed by the 2026-07-30 security quickwins PR**; residual 1 × 4 = 4 (Low).
- **R-024**: 178 of 293 API routes have no `checkRateLimit` (per the 2026-07-30 control matrix CC6.6 P0 #4). Inherent: 5 × 4 = 20 (Critical). Treatment: roll `checkRateLimit('standard')` out to 178 routes per the `RATE_LIMIT_ROLLOUT_SCOPE.md` plan. **Status: In treatment.** Owner: Cody. Target: 2026-09-30.
- **R-025**: PII field length caps missing in survey schema (per the 2026-07-30 control matrix CC6.7 P0). Inherent: 3 × 3 = 9 (Medium). Treatment: add length caps in the Zod schema. Owner: Cody. Target: 2026-09-15.

The R-024 risk is the load-bearing example: the rate-limit rollout is the highest-impact security workstream in flight, the rollout is the §8.5 ad-hoc review trigger when each batch of routes ships, and the §8.6 annual reassessment verifies the rollout is complete.

## 6. Risk treatment

The treatment is the action taken to reduce the inherent risk to the residual risk. The treatment options are: mitigate, transfer, accept, avoid.

### 6.1 Mitigate

**Mitigate** is the default treatment. Mitigate means: reduce the likelihood or the impact (or both) through a control. The control is documented in the `treatment_description` + `linked_controls` columns. The mitigation is the §2.4 residual risk; the §2.4 control effectiveness is the measure.

The mitigation is the most common treatment. The 2026-07-30 control matrix's 78 control rows are the mitigations; the risk register's `linked_controls` column maps each risk to the mitigating controls.

A mitigation is **closed** when the control is **Implemented** (per the control matrix's status column) and the residual risk is in the Low band. A mitigation is **in progress** when the control is **Partial** and the residual risk is in the Medium band or higher. A mitigation is **failed** when the residual risk is in the High or Critical band; the §2.4 escalation fires.

### 6.2 Transfer

**Transfer** means: shift the financial impact to a third party (typically an insurance carrier) while retaining the operational responsibility. Examples:

- **Cyber liability insurance** — transfers the financial impact of a data breach (legal fees, notification costs, credit monitoring, regulatory fines) to the insurance carrier. The Solarpro cyber liability policy is the operational counter to the §3.4 compliance risks.
- **Vendor SLA credits** — transfers part of the financial impact of a vendor outage to the vendor (per the vendor's SLA). The Vercel / Neon / Render SLAs are the operational counter to the §3.2 operational risks.
- **Professional liability insurance** — transfers the financial impact of a customer-facing error (e.g. an incorrect planset) to the insurance carrier.

A transferred risk is tracked in the register with the `treatment` = `transfer` and the `treatment_description` naming the carrier / SLA. The residual risk is the post-transfer impact; the likelihood is unchanged.

### 6.3 Accept

**Accept** means: explicitly decide not to mitigate or transfer the risk, and document the rationale. Acceptance is allowed only for:

- **Low-band risks** (score 1-4) — the residual risk is acceptable; the cost of mitigation exceeds the benefit.
- **Medium-band risks** with a documented business rationale — the cost of mitigation exceeds the benefit, and the business has explicitly accepted the residual risk.

Acceptance requires:

1. **A written rationale** in the `notes` column (e.g. "the cost of mitigating the 3D math test coverage gap is 6-8 weeks; the risk is bounded to internal engineering outputs, not customer PII; the company has accepted the residual risk to prioritize the rate-limit rollout").
2. **A signature from James** in the `notes` column (e.g. "James accepted 2026-08-15").
3. **A re-evaluation date** in the `target_date` column (e.g. "2027-08-15" for the annual reassessment).

A risk that is accepted and then materializes is escalated to James within 1 business day; the §8.5 ad-hoc review is triggered.

### 6.4 Avoid

**Avoid** means: eliminate the activity that creates the risk. Examples:

- **Discontinue a feature** that creates a compliance risk (e.g. discontinue the public API if the API key management is not sustainable).
- **Decline a customer** whose data residency requirements are not met (e.g. decline a customer that requires EU-only data storage if the current deployment is US-only).
- **Exit a market** whose regulatory burden is disproportionate (e.g. exit the EU market if the GDPR compliance cost is unsustainable).

An avoided risk is tracked in the register with the `treatment` = `avoid` and the `treatment_description` naming the avoided activity. The `status` is `Closed` (the risk no longer exists).

## 7. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **Risk owner — commercial** | **James Carpenter** | Owns the strategic, financial, reputational, and customer-facing risks. Reviews the §3.1, §3.3, §3.5 risks in the §8.3 quarterly review. Approves the §6.3 acceptance rationale for any commercial risk. |
| **Risk owner — security** | **Raymond O'Brien** | Owns the compliance, operational, third-party, and threat-intel risks. Reviews the §3.2, §3.4, §3.7, §3.8 risks in the §8.3 quarterly review. Approves the §6.3 acceptance rationale for any security risk. Owns the register; updates the rows; runs the §8.6 annual reassessment. |
| **Risk owner — technical** | **Cody** | Owns the technical risks. Reviews the §3.6 risks in the §8.3 quarterly review. Implements the §6.1 mitigations for technical risks. Files the §4.2 incident reports that feed the register. |
| **Risk owner — privacy** | **Raymond O'Brien** (delegable to James) | Owns the privacy risks (the §3.4 compliance risks that are PII-related). Reviews the privacy risks in the §8.3 quarterly review. Approves the §6.3 acceptance rationale for any privacy risk. |
| **All team members** | James, Raymond, Cody | File a risk identification report (Linear issue tagged `risk-identification`) when they identify a new risk. The report feeds the §4 risk identification sources. |

A risk ownership dispute (e.g. a risk that crosses the security / commercial boundary) is escalated to James for resolution within 1 business day.

## 8. Risk review cadence

The cadence is the §8.3 quarterly review + the §8.5 ad-hoc review after every Sev1 incident + the §8.6 annual comprehensive reassessment. The cadence is the operational counter to "the register goes stale and the auditor finds a risk that was not reviewed in 12 months."

### 8.3 Quarterly review

**Cadence**: every 90 days, on the 15th of the month following the quarter end (January 15, April 15, July 15, October 15). **Owner**: Raymond (CISO). **Participants**: James + Raymond + Cody.

**Agenda**:

1. **Review the §4 risk identification sources** since the last review. Add new rows; update existing rows.
2. **Re-score the High and Critical risks** (the §2.3 band). The re-score verifies the residual risk is still in the band reported.
3. **Review the §6.3 acceptances**. Verify the re-evaluation date is still valid; update the rationale if the conditions have changed.
4. **Review the §6.1 mitigations in progress**. Verify the `target_date` is still achievable; escalate any missed target dates.
5. **Review the §4.2 incident reports**. Verify the incidents are reflected in the register.
6. **File the review notes** at `compliance/risks/reviews/<YYYY-Q#>-review.md`. The review notes are the §8.7 audit trail.

**Output**: an updated `compliance/risks/register.csv` + the review notes. The review notes are signed by James + Raymond + Cody.

### 8.5 Ad-hoc review (after every Sev1 incident)

**Trigger**: a Sev1 incident per Policy #05 §4. **Owner**: Raymond (CISO). **Cadence**: within 5 business days of the incident closure.

**Agenda**:

1. **Identify the new risks** the incident exposed. Add rows to the register.
2. **Re-score the risks** the incident affected. The incident may have changed the likelihood (e.g. a new vulnerability is in the wild) or the impact (e.g. the customer trust is eroded).
3. **Update the §6.1 mitigations**. The incident's postmortem may identify a new mitigation; the register reflects the new mitigation.
4. **File the review notes** at `compliance/risks/reviews/sev1-<incident-id>-review.md`.

**Output**: an updated `compliance/risks/register.csv` + the review notes. The review notes are signed by James + Raymond.

### 8.6 Annual comprehensive reassessment

**Cadence**: by August 15 of each year, in alignment with the Information Security Policy (#01) annual review. **Owner**: Raymond (CISO). **Participants**: James + Raymond + Cody + the auditor (if engaged).

**Agenda**:

1. **Re-score every row in the register**. The annual reassessment is the full review; the §2.1 likelihood and §2.2 impact scores are re-evaluated.
2. **Refresh the §3 risk categories**. New categories may have emerged (e.g. an AI-specific risk category if Solarpro adds ML features).
3. **Refresh the §4 risk identification sources**. New sources may have emerged (e.g. a new threat-intel feed).
4. **Verify the §6.3 acceptances**. The acceptances are re-evaluated; the rationale is updated; the re-evaluation date is reset.
5. **Cross-reference the control matrix**. The `linked_controls` column is verified against the current state of the control matrix; rows that should have a control but do not are escalated.
6. **File the review notes** at `compliance/risks/reviews/<YYYY>-annual-review.md`. The review notes are the §8.7 audit trail.

**Output**: an updated `compliance/risks/register.csv` + the review notes. The review notes are signed by James + Raymond.

### 8.7 Audit trail

The audit trail is the §8.3 review notes + the §8.5 review notes + the §8.6 review notes + the per-row `last_reviewed` dates. The audit trail is the SOC 2 CC3.1 / CC3.2 / CC3.4 evidence. The auditor reads the review notes to verify the cadence is operating.

## 9. Risk appetite and tolerance

The risk appetite is the **aggregate level of risk** Solarpro is willing to accept. The risk tolerance is the **acceptable deviation** from the appetite for individual risks.

### 9.1 Risk appetite

Solarpro's risk appetite is **Medium**. The company accepts Medium-band residual risks with a documented rationale; the company treats High-band and Critical-band risks urgently; the company does not accept any risk that threatens the SOC 2 / ISO 27001 certification or the GDPR / CCPA compliance posture.

The appetite is set by James (CEO) and reviewed annually in the §8.6 reassessment. A change in the appetite is a §11 material change to this policy.

### 9.2 Risk tolerance per category

The tolerance is the acceptable band per category. The tolerance is tighter for compliance + privacy risks; the tolerance is looser for technical + operational risks where the cost of mitigation can be disproportionate.

| Category | Tolerance | Rationale |
|---|---|---|
| **Strategic** | Medium | The company accepts Medium-band strategic risks; the High-band strategic risks are treated. |
| **Operational** | Medium | The company accepts Medium-band operational risks (e.g. a 30-minute Render cold start); the High-band operational risks are treated. |
| **Financial** | Medium | The company accepts Medium-band financial risks; the cost-overrun cap (per Policy #24 §7.5) is the tolerance. |
| **Compliance** | Low | The company does not accept Medium-or-higher compliance risks; the cert is at risk. |
| **Reputational** | Medium | The company accepts Medium-band reputational risks; the High-band reputational risks are treated. |
| **Technical** | Medium | The company accepts Medium-band technical risks; the P0 control matrix items are the High-band. |
| **Third-party** | Medium | The company accepts Medium-band third-party risks; the High-band risks (e.g. a vendor with no SOC 2 report) are treated. |
| **Privacy** | Low | The company does not accept Medium-or-higher privacy risks; the PII exposure is the cert at risk. |

The tolerance is the §6.3 acceptance ceiling. A risk in a Low-tolerance category cannot be accepted above the Low band.

## 10. Exception process

An exception to a control that mitigates a risk follows the Information Security Policy (#01) §8 exception process:

1. **Documented** in a Linear issue tagged `compliance-exception` + `risk-exception`.
2. **Approved by Raymond** (CISO) with a stated duration (max 90 days without re-approval).
3. **Disclosed to James** if the exception involves a P0 control, a Sev1-classified incident, a compliance risk, or a privacy risk.
4. **Reflected in the register** — the `treatment` column is updated to `accept` (or `transfer` if the exception is to transfer rather than mitigate) and the `notes` column records the exception.

A risk that is accepted under an exception is re-evaluated in the §8.3 quarterly review + the §8.6 annual reassessment. An exception that is not re-evaluated is escalated to James within 5 business days.

## 11. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §2 methodology (the scoring scales may need adjustment), a refresh of the §3 categories (new categories may have emerged), a refresh of the §6 treatment options (new options may have emerged), and a refresh of the §9 risk appetite.
- **On material change** — within 30 days of any of: a new framework in scope, a new Tier 1 vendor, a change in the company ownership of more than 25%, a new product line that changes the risk surface, or a change in the §9 risk appetite.
- **After every Sev1 incident** — the §8.5 ad-hoc review is triggered.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 12. Related documents

- `compliance/policies/01-information-security.md` — the foundation; the §8 exception process + the §6 framework coverage.
- `compliance/policies/05-incident-response.md` — the §8.5 ad-hoc review trigger; the §4.2 incident reports that feed the register.
- `compliance/policies/08-logging-monitoring.md` — the §4.2 incident detection that feeds the register.
- `compliance/policies/10-vendor-risk-management.md` — the §4.3 vendor reviews that feed the register; the §3.7 third-party risks.
- `compliance/policies/12-employee-onboarding-offboarding.md` — the §3.2 operational risk (a team member departure); the 24-hour offboarding SLA.
- `compliance/policies/18-privacy-policy.md` — the privacy posture that the §3.4 compliance risks and the §3.8 threat-intel risks reference.
- `compliance/policies/22-business-continuity-disaster-recovery.md` — the §3.2 operational risks; the §6.2 vendor SLA transfer.
- `compliance/policies/23-patch-management.md` — the §3.6 technical risks; the §4.4 threat-intel feeds.
- `compliance/policies/24-cloud-services-security.md` — the §3.2 operational risks (the 12-vendor stack).
- `compliance/policies/26-virtual-environment-security.md` — the §3.6 technical risks (the 9-environment inventory).
- `compliance/CONTROL_MATRIX.md` — the 78 control rows + the 19-row risk register that seed `compliance/risks/register.csv`.
- `compliance/risks/register.csv` — the canonical risk register.
- `compliance/risks/reviews/` — the §8.3, §8.5, §8.6 review notes (the audit trail).
- `RATE_LIMIT_ROLLOUT_SCOPE.md` — the §5.2 R-024 risk treatment scope.
- `SECURITY_ADVISORY_DEPS.md` — the §4.4 threat-intel artifact.
- `audit_security_migrations_2026-07-30.md` — the 2026-07-30 audit that closes the R-022, R-023, R-024, R-025 risks.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the §2 likelihood × impact methodology (1-5 each, 1-25 inherent; residual = post-treatment), the §3 risk categories (strategic / operational / financial / compliance / reputational / technical / third-party + threat-intel), the §4 risk identification sources (audit findings / incident reports / vendor reviews / threat intel / regulatory changes / customer feedback), the §5 risk register schema + the 19 seed rows from the 2026-07-30 control matrix + 6 new risks (R-020 through R-025 — GDPR breach notification, PII redaction, rate-limiter fail-open [closed by the security quickwins PR], NODE_ENV-as-Secure [closed], 178 routes without rate limit [in treatment], PII field length caps [in treatment]), the §6 treatment options (mitigate / transfer / accept / avoid), the §7 roles (James = commercial; Raymond = security + privacy; Cody = technical), the §8 review cadence (quarterly + ad-hoc after Sev1 + annual comprehensive reassessment), the §9 risk appetite (Medium; Low for compliance + privacy), the §10 exception process, and the §11 review cadence. The R-024 risk is the load-bearing example — the rate-limit rollout is the highest-impact security workstream in flight and the §8.5 ad-hoc review trigger. Closes the SOC 2 CC3.1 / CC3.2 / CC3.4 control set explicitly; the 2026-07-30 control matrix had these as Implemented (with the four audit reports as evidence); this policy formalizes the register as a standalone, living artifact at `compliance/risks/register.csv`. |
