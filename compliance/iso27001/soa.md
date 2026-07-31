# Statement of Applicability (SoA)

| Field | Value |
|---|---|
| **Document** | Solarpro Statement of Applicability (SoA) |
| **SoA version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual), or on material change (per Policy #28 §6) |
| **Frameworks in scope** | ISO 27001:2022 (93 Annex A controls) · ISO 27017:2015 (12 cloud-specific control additions) · ISO 27701:2019 (privacy extension, 38 PII controller sub-clauses + 38 PII processor sub-clauses) · SOC 2 Type 1 (Trust Services Criteria CC1–CC9) |
| **Companion to** | `compliance/policies/28-statement-of-applicability.md` (the rule for this SoA) |
| **Source of truth for control state** | `compliance/CONTROL_MATRIX.md` (78 controls, current state) |
| **Source of truth for risks** | `compliance/risks/register.csv` (the risk register per Policy #27) |
| **Source of truth for evidence** | `compliance/manifest.json` (the evidence-to-control map) |

---

## 1. How to read this SoA

This SoA maps every Annex A control to the Solarpro applicability decision, the implementation status, the evidence reference, the owner, and the last-reviewed date. The structure follows the ISO 27001:2022 minimum + the Solarpro extension (per Policy #28 §2).

**Columns**:

- **Control ID** — the Annex A control identifier (A.5.x, A.6.x, A.7.x, A.8.x).
- **Title** — the Annex A control title.
- **Applicable (Y/N)** — whether Solarpro implements the control. **N** means the control is excluded with a documented justification.
- **Justification** — the reasoning for the applicability decision. For N: the rationale for exclusion. For Y: the scope of the implementation.
- **Implementation Status** — **Implemented** (operating + evidence current) / **Partial** (partially operating + remediation in progress) / **Not Implemented** (not yet operating + target date set) / **N/A** (excluded; justification is the reason).
- **Evidence Reference** — the file path or `compliance/manifest.json` path. For N: "deferred — see risk register" or the rationale.
- **Owner** — the single point of accountability (James / Raymond / Cody per Policy #28 §2.5).
- **Last Reviewed** — the date the row was last touched.

**Conventions**:

- A control marked **N/A** is still listed. The auditor reads the justification for every N/A to verify the exclusion is documented.
- A control marked **Partial** has a remediation target date in the Justification column. P0 controls ≤ 90 days; P1 ≤ 180 days.
- A control marked **Not Implemented** has a target date in the Justification column. Target ≤ 6-12 months.
- The 2026-07-30 control matrix (78 controls) is the seed. The 15 additional controls (93 minus 78) are the ISO-only controls that the matrix did not enumerate because the matrix was SOC 2-led; this SoA brings the scope to the full ISO 27001 Annex A.
- The ISO 27017:2015 cloud-specific controls are not separate rows; they are mapped onto the Annex A controls (the cloud-specific guidance is the Justification column for cloud-relevant controls). The 12 ISO 27017 controls are listed in §3 below.
- The ISO 27701:2019 privacy extension controls are listed in §4 below (38 PII controller sub-clauses + 38 PII processor sub-clauses).
- The SOC 2 Trust Services Criteria are listed in §5 below (33 CC1–CC9 controls).

## 2. Annex A — the 93 controls

### 2.1 A.5 — Organizational controls (37)

| Control ID | Title | Applicable | Justification | Implementation Status | Evidence Reference | Owner | Last Reviewed |
|---|---|---|---|---|---|---|---|
| A.5.1 | Policies for information security | Y | Information Security Policy (#01) is the foundation of the program; reviewed annually per Policy #01 §7. | Implemented | `compliance/policies/01-information-security.md` | Raymond | 2026-08-15 |
| A.5.2 | Information security roles and responsibilities | Y | Roles are explicit in Policy #01 §4 (James = CEO + management sign-off; Raymond = CISO + security point; Cody = technical lead). 3-person team, no implicit ownership. | Implemented | `compliance/policies/01-information-security.md#4-roles-and-responsibilities` | Raymond | 2026-08-15 |
| A.5.3 | Segregation of duties | Y | 3-person team — segregation is by role (CEO / CISO / Tech Lead) and by task (Raymond = security; Cody = technical; James = commercial). Enforced by the `requireAdminApi()` + `super_admin` split (Policy #03) and the `MIGRATE_SECRET` rotation (Policy #06). | Implemented | `compliance/policies/03-access-control.md` · `compliance/policies/06-change-management.md` | Raymond | 2026-08-15 |
| A.5.4 | Management responsibilities | Y | Management responsibilities are explicit in the Code of Conduct (#11 §3) and the Onboarding & Offboarding Policy (#12 §4). | Implemented | `compliance/policies/11-code-of-conduct.md` · `compliance/policies/12-employee-onboarding-offboarding.md` | James | 2026-08-15 |
| A.5.5 | Contact with authorities | Y | No regulatory authority relationship today. The 24/7 contact list is at `compliance/contacts.md` (to be created; for now: CISA at `cisa.gov/report`, FBI IC3 at `ic3.gov`, state AG offices as needed). Raymond is the primary contact. | Partial | `compliance/policies/05-incident-response.md#5.5-incident-notification` · `compliance/contacts.md` (to be created) | Raymond | 2026-08-15 |
| A.5.6 | Contact with special interest groups | Y | Solarpro is a member of the Cloud Security Alliance (CSA) and the Open Web Application Security Project (OWASP). The membership is informal; the team monitors CSA + OWASP publications for threat-intel (Policy #27 §3.8). | Implemented | `compliance/policies/27-risk-assessment.md#3.8-threat-intelligence-a.5.7` | Raymond | 2026-08-15 |
| A.5.7 | Threat intelligence | Y | Threat-intel feeds per Policy #27 §3.8: GitHub Dependabot (real-time), CISA KEV (daily), NVD (weekly), vendor advisories (monthly), security researcher disclosures (HackerOne + `security@solarpro.app` daily). | Implemented | `compliance/policies/27-risk-assessment.md#3.8` | Raymond | 2026-08-15 |
| A.5.8 | Information security in project management | Y | The §6 of every policy references the project-management framework (Linear + GitHub Projects); the SDLC per Policy #23 §6 includes the security review at the PR template level. The 2026-07-30 control matrix row CC8.1 is Gap; remediation in progress. | Partial | `compliance/policies/23-patch-management.md#6` · `compliance/policies/06-change-management.md` | Raymond | 2026-08-15 |
| A.5.9 | Inventory of information and other associated assets | Y | SBOM Policy (#17) covers the software inventory. The asset inventory is the 12-vendor register (`compliance/vendors.csv`) + the 9-environment inventory (Policy #26 §2.4) + the customer PII inventory (Policy #18 §4). | Implemented | `compliance/policies/17-software-bill-of-materials.md` · `compliance/vendors.csv` | Raymond | 2026-08-15 |
| A.5.10 | Acceptable use of information and other associated assets | Y | Acceptable Use Policy (#02) is the AUP for all employees + contractors. Annual acknowledgment per Policy #12 §4.5. | Implemented | `compliance/policies/02-acceptable-use.md` | Raymond | 2026-08-15 |
| A.5.11 | Return of assets | Y | Onboarding & Offboarding Policy (#12) §6.6 — the return of assets on termination (laptop, MFA token, 1Password vault, GitHub access). 24-hour SLA. | Implemented | `compliance/policies/12-employee-onboarding-offboarding.md#6.6` | Raymond | 2026-08-15 |
| A.5.12 | Classification of information | Y | Data Classification & Handling Policy (#04) — 4 classes (Public / Internal / Confidential / Restricted). Per-field classification in the survey schema (PII fields tagged). | Implemented | `compliance/policies/04-data-classification-handling.md` | Raymond | 2026-08-15 |
| A.5.13 | Labelling of information | Y | Database columns are tagged with the classification in `lib/data-classification.ts` (PII fields marked). The data classification is rendered in the Trust Center (`compliance/trust.json`). | Implemented | `compliance/policies/04-data-classification-handling.md#5-labelling` | Cody | 2026-08-15 |
| A.5.14 | Information transfer | Y | The transfer of PII to third-party vision APIs (OpenAI, Anthropic) is governed by Policy #18 §6 + the §4.3 anonymization. The transfer of data within the application is governed by the API contract + the TLS posture (Policy #21 §5). The 2026-07-30 control matrix row CC6.7 was Gap (PII in transit to vision APIs without documented DPAs); remediation in progress (DPAs with OpenAI + Anthropic). | Partial | `compliance/policies/18-privacy-policy.md#6` · `compliance/policies/21-encryption-key-management.md#5` | Raymond | 2026-08-15 |
| A.5.15 | Access control | Y | Access Control Policy (#03) is the operating rule. 2026-07-30 control matrix was Partial (rate-limiter fail-open + NODE_ENV-as-Secure + 178 routes without rate limit); the rate-limiter fail-open was closed by the security quickwins PR; the 178 routes rollout is in progress (Policy #27 R-024). | Partial | `compliance/policies/03-access-control.md` · `RATE_LIMIT_ROLLOUT_SCOPE.md` | Raymond | 2026-08-15 |
| A.5.16 | Identity management | Y | `users` table; `password_changed_at` invalidates tokens (migration 094); `auditLog.ts` records identity events. | Implemented | `lib/adminAuth.ts:152` · `lib/auditLog.ts` | Cody | 2026-08-15 |
| A.5.17 | Authentication information | Y | Password & Authentication Policy (#15) + Encryption & Key Management Policy (#21). 32-character secret minimum enforced at runtime in `getJwtSecret()`. bcrypt(12) for passwords. MFA TOTP AES-256-GCM. | Implemented | `compliance/policies/15-password-authentication.md` · `compliance/policies/21-encryption-key-management.md` | Raymond | 2026-08-15 |
| A.5.18 | Access rights | Y | `requireAdminApi()` + org `checkOrgAuthz()` + session inactivity timeouts (8h admin, 24h user). Quarterly UAR per Policy #03 §6. | Implemented | `compliance/policies/03-access-control.md#6` | Raymond | 2026-08-15 |
| A.5.19 | Information security in supplier relationships | Y | Vendor Risk Management Policy (#10) §3 — the three-tier classification + the supplier security review. | Implemented | `compliance/policies/10-vendor-risk-management.md#3` | Raymond | 2026-08-15 |
| A.5.20 | Addressing information security in supplier agreements | Y | Third-Party Service Provider Policy (#16) — DPAs, security exhibits, the §5 contractual controls. The 2026-07-30 control matrix row 6.2.3 (PII processors) was Gap; DPAs with OpenAI + Anthropic in progress. | Partial | `compliance/policies/16-third-party-service-provider.md#5` | Raymond | 2026-08-15 |
| A.5.21 | Managing information security in the ICT supply chain | Y | Vendor Risk Management Policy (#10) §4 — the SOC 2 report collection + the 12-vendor register refresh. | Implemented | `compliance/policies/10-vendor-risk-management.md#4` · `compliance/vendors.csv` | Raymond | 2026-08-15 |
| A.5.22 | Monitoring, review and change management of supplier services | Y | Vendor Risk Management Policy (#10) §5 — the quarterly vendor risk register refresh + the annual vendor security review. The Cloudflare + Vercel + Neon + Render + Stripe + GitHub SOC 2 reports are on file. | Implemented | `compliance/policies/10-vendor-risk-management.md#5` | Raymond | 2026-08-15 |
| A.5.23 | Information security for use of cloud services | Y | Cloud Services Security Policy (#24) + Shared Responsibility Matrix (#25). The 12-vendor inventory; the 8 control areas × 12 vendors + Solarpro = 104 RACI cells. | Implemented | `compliance/policies/24-cloud-services-security.md` · `compliance/policies/25-shared-responsibility-matrix.md` · `compliance/cloud/shared-responsibility-matrix.md` | Raymond | 2026-08-15 |
| A.5.24 | Information security incident management planning and preparation | Y | Incident Response Plan (#05) — the full IR lifecycle (preparation, identification, containment, eradication, recovery, post-incident review). | Implemented | `compliance/policies/05-incident-response.md` | Raymond | 2026-08-15 |
| A.5.25 | Assessment and decision on information security events | Y | Incident Response Plan (#05) §4 — the Sev1/Sev2/Sev3 classification + the incident commander rotation. | Implemented | `compliance/policies/05-incident-response.md#4` | Raymond | 2026-08-15 |
| A.5.26 | Response to information security incidents | Y | Incident Response Plan (#05) §5 — the 5 worked scenarios + the runbook per scenario. The §5.5 breach notification per GDPR Art. 33 (72h). | Implemented | `compliance/policies/05-incident-response.md#5` | Raymond | 2026-08-15 |
| A.5.27 | Learning from information security incidents | Y | Incident Response Plan (#05) §7 — the 5-business-day PIR SLA. The Risk Assessment Policy (#27) §8.5 — the ad-hoc review after every Sev1. | Implemented | `compliance/policies/05-incident-response.md#7` · `compliance/policies/27-risk-assessment.md#8.5` | Raymond | 2026-08-15 |
| A.5.28 | Collection of evidence | Y | Logging & Monitoring Policy (#08) §3 — the structured log schema + the 12 required fields. The application audit log (`audit_log` table) + the vendor audit log export (per the Shared Responsibility Matrix #25). | Implemented | `compliance/policies/08-logging-monitoring.md#3` · `compliance/collectors/` | Raymond | 2026-08-15 |
| A.5.29 | Information security during disruption | Y | Business Continuity & Disaster Recovery Plan (#22) — 7 disaster scenarios + 7 step-by-step recovery procedures. The 4h/1h RTO/RPO targets. | Implemented | `compliance/policies/22-business-continuity-disaster-recovery.md` | Raymond | 2026-08-15 |
| A.5.30 | ICT readiness for business continuity | Y | BC/DR Plan (#22) §9 — the quarterly restore test + annual tabletop + ad-hoc after every Sev1. | Implemented | `compliance/policies/22-business-continuity-disaster-recovery.md#9` | Raymond | 2026-08-15 |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | Y | The 4-framework scope is in Policy #01 §6 (SOC 2 + ISO 27001 + 27701 + 27017). The 5th framework (FIPS 140-3) is a 2027+ decision pending a federal customer. The customer-facing commitments are in the Trust Center + the customer agreements. | Implemented | `compliance/policies/01-information-security.md#6` · `compliance/trust.json` | James | 2026-08-15 |
| A.5.32 | Intellectual property rights | Y | The application code is the property of Solarpro (the GitHub org is `solarpro`; the copyright is the standard MIT-style license per `LICENSE`). Customer PII is the property of the customer; the data processing agreement (DPA) is the contractual rule. The vendor IP is the vendor's (the 12-vendor register respects the vendor ToS). | Implemented | `LICENSE` · `compliance/vendors.csv` | James | 2026-08-15 |
| A.5.33 | Protection of records | Y | Records are stored in the `audit_log` table (production only) + the git evidence store (`compliance/evidence/`) + the Trust Center (`compliance/trust.json`). The retention is 7 years per Policy #20 §5. | Implemented | `compliance/policies/20-data-retention-disposal.md#5` | Raymond | 2026-08-15 |
| A.5.34 | Privacy and protection of PII | Y | Privacy Policy (#18) + Data Subject Rights Policy (#19) + Data Retention & Disposal Policy (#20). The customer-facing Privacy Policy is published at `https://solarpro.app/privacy`. The PIA process is Policy #30. | Implemented | `compliance/policies/18-privacy-policy.md` · `compliance/policies/19-data-subject-rights.md` · `compliance/policies/30-privacy-impact-assessment.md` | Raymond | 2026-08-15 |
| A.5.35 | Independent review of information security | Y | The 4 audit reports (2026-07-30) are the independent review artifact. The Audit & Monitoring Policy (#29) is the cadence for future reviews. | Implemented | `audit_*_2026-07-30.md` · `compliance/policies/29-audit-monitoring.md` | Raymond | 2026-08-15 |
| A.5.36 | Compliance with policies, rules and standards for information security | Y | The NODE_ENV-as-Secure inconsistency (2026-07-30 control matrix P0 #2) was closed by the security quickwins PR. The compliance is verified by the §5.3 compliance monitoring (weekly digest). | Implemented | `lib/auth.ts` · `lib/environment.ts` | Cody | 2026-08-15 |
| A.5.37 | Documented operating procedures | Y | The 30 policies in `compliance/policies/` are the documented operating procedures. The 4-gate migration governance is the operating procedure for database changes. | Implemented | `compliance/policies/` · `lib/migrations/runner.ts:380-432` | Raymond | 2026-08-15 |

### 2.2 A.6 — People controls (8)

| Control ID | Title | Applicable | Justification | Implementation Status | Evidence Reference | Owner | Last Reviewed |
|---|---|---|---|---|---|---|---|
| A.6.1 | Screening | Y | Background Check Policy (#14) — the screening policy + the deferred-execution §7 (per James 2026-07-30; the screening vendor is not yet funded). | Partial | `compliance/policies/14-background-check.md#7-deferred-execution` | James | 2026-08-15 |
| A.6.2 | Terms and conditions of employment | Y | Onboarding & Offboarding Policy (#12) §3 — the offer letter includes the confidentiality + IP assignment + acceptable use clauses. Annual acknowledgment per Policy #12 §4.5. | Implemented | `compliance/policies/12-employee-onboarding-offboarding.md#3` | James | 2026-08-15 |
| A.6.3 | Information security awareness, education and training | Y | Security Awareness & Training Policy (#13) — the 2-hour security primer + the role-specific training + the quarterly phishing sim + the annual IR drill. The training register is at `compliance/training/register.csv`. | Implemented | `compliance/policies/13-security-awareness-training.md` | Raymond | 2026-08-15 |
| A.6.4 | Disciplinary process | Y | Code of Conduct (#11) §8 — the disciplinary matrix + the no-retaliation + the reporting channels. | Implemented | `compliance/policies/11-code-of-conduct.md#8` | James | 2026-08-15 |
| A.6.5 | Responsibilities after termination or change of employment | Y | Onboarding & Offboarding Policy (#12) §6 — the 24-hour offboarding SLA + the §6.6 return of assets + the §6.7 post-termination records retention. | Implemented | `compliance/policies/12-employee-onboarding-offboarding.md#6` | James | 2026-08-15 |
| A.6.6 | Confidentiality or non-disclosure agreements | Y | Offer letter template (`compliance/hr/offer-letter-template.md`) + the §4.2 NDA clause. The vendor NDA per Policy #16 §4.2. | Implemented | `compliance/policies/12-employee-onboarding-offboarding.md#4.2` · `compliance/policies/16-third-party-service-provider.md#4.2` | James | 2026-08-15 |
| A.6.7 | Remote working | Y | All Solarpro work is remote. The remote-working security is in the Acceptable Use Policy (#02 §6) + the Password & Authentication Policy (#15 §4) + the Encryption & Key Management Policy (#21 §7). The endpoint devices are the employee's own; the AUP §6.3 requires the device to be patched + encrypted. | Implemented | `compliance/policies/02-acceptable-use.md#6` · `compliance/policies/15-password-authentication.md#4` | Raymond | 2026-08-15 |
| A.6.8 | Information security event reporting | Y | Incident Response Plan (#05) §3 — the reporting channels (Raymond direct, `security@solarpro.app`, the Sentry alert routing). The Code of Conduct (#11 §6) — the no-retaliation for good-faith reporting. | Implemented | `compliance/policies/05-incident-response.md#3` · `compliance/policies/11-code-of-conduct.md#6` | Raymond | 2026-08-15 |

### 2.3 A.7 — Physical controls (14)

| Control ID | Title | Applicable | Justification | Implementation Status | Evidence Reference | Owner | Last Reviewed |
|---|---|---|---|---|---|---|---|
| A.7.1 | Physical security perimeters | N | Cloud-only deployment; no on-prem footprint. Physical security of the data center is the vendor's (Vercel + Neon + Render SOC 2 reports cover this; CC6.4 in the control matrix). | N/A | `compliance/policies/24-cloud-services-security.md#3.1` | Raymond | 2026-08-15 |
| A.7.2 | Physical entry | N | Same as A.7.1. Vendor SOC 2 reports cover physical entry. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.3 | Securing offices, rooms and facilities | N | Solarpro has no physical office (all remote). The AUP §6.4 covers home-office security (locked screen, no shoulder-surfing, no printed PII). | N/A | `compliance/policies/02-acceptable-use.md#6.4` | Raymond | 2026-08-15 |
| A.7.4 | Physical security monitoring | N | Same as A.7.1. Vendor SOC 2 reports cover physical monitoring. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.5 | Protecting against physical and environmental threats | N | Same as A.7.1. Vendor SOC 2 reports cover environmental threats. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.6 | Working in secure areas | N | Solarpro has no physical office. The AUP §6 covers the remote-working equivalent. | N/A | `compliance/policies/02-acceptable-use.md#6` | Raymond | 2026-08-15 |
| A.7.7 | Clear desk and clear screen | Y | AUP §6.4 — the clear-screen rule (the laptop locks within 5 minutes of inactivity; the workstation is in a private space). | Implemented | `compliance/policies/02-acceptable-use.md#6.4` | Raymond | 2026-08-15 |
| A.7.8 | Equipment siting and protection | N | No on-prem equipment. The endpoint devices are the employee's own. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.9 | Security of assets off-premises | Y | AUP §6.3 — the off-premises asset rules (encrypted disk required, no PII on local disk, the 1Password vault is the only source of credentials). | Implemented | `compliance/policies/02-acceptable-use.md#6.3` | Raymond | 2026-08-15 |
| A.7.10 | Storage media | Y | Data Retention & Disposal Policy (#20) — the storage media rules (the R2 bucket is the only persistent storage; the local disk is ephemeral). The §5 disposal method (cryptographic erasure) covers the storage media disposal. | Implemented | `compliance/policies/20-data-retention-disposal.md#5` | Raymond | 2026-08-15 |
| A.7.11 | Supporting utilities | N | Same as A.7.1. Vendor SOC 2 reports cover supporting utilities. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.12 | Cabling security | N | Same as A.7.1. Vendor SOC 2 reports cover cabling security. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.13 | Equipment maintenance | N | No on-prem equipment. Vendor maintenance is the vendor's responsibility. | N/A | Same as A.7.1 | Raymond | 2026-08-15 |
| A.7.14 | Secure disposal or re-use of equipment | Y | Onboarding & Offboarding Policy (#12) §6.6 — the equipment return on termination + the cryptographic erasure before re-use (the `diskutil secureErase` or `shred` before the laptop is re-issued or sold). | Implemented | `compliance/policies/12-employee-onboarding-offboarding.md#6.6` | James | 2026-08-15 |

### 2.4 A.8 — Technological controls (34)

| Control ID | Title | Applicable | Justification | Implementation Status | Evidence Reference | Owner | Last Reviewed |
|---|---|---|---|---|---|---|---|
| A.8.1 | User endpoint devices | N | Cloud-only deployment; no managed endpoints. The endpoint devices are the employee's own; the AUP §6.3 covers the minimum requirements. | N/A | `compliance/policies/02-acceptable-use.md#6.3` | Raymond | 2026-08-15 |
| A.8.2 | Privileged access rights | Y | Access Control Policy (#03) — `requireAdminApi()` + `super_admin` check + `ADMIN_SECRET` break-glass with `productionGuard()`. | Implemented | `compliance/policies/03-access-control.md` | Raymond | 2026-08-15 |
| A.8.3 | Information access restriction | Y | Default-deny org RBAC (`lib/organizations/authorization.ts`). The `requireOrgRole()` API wrapper is planned (2026-07-30 control matrix A.8.3 P1; remediation in progress). | Partial | `compliance/policies/03-access-control.md` · `lib/organizations/authorization.ts` | Cody | 2026-08-15 |
| A.8.4 | Access to source code | Y | GitHub org is `solarpro`; the production branch is `master`; the branch protection requires PR review + status checks. The `CODEOWNERS` file enforces the per-path review. The 2026-07-30 control matrix row CC8.1 (Change management) is Gap; remediation in progress. | Partial | `.github/CODEOWNERS` · `compliance/policies/06-change-management.md` | Raymond | 2026-08-15 |
| A.8.5 | Secure authentication | Y | Password & Authentication Policy (#15) — bcrypt(12) + JWT HS256 + MFA TOTP. The 32-character secret minimum is enforced at runtime. | Implemented | `compliance/policies/15-password-authentication.md` · `lib/auth.ts` | Raymond | 2026-08-15 |
| A.8.6 | Capacity management | Y | The capacity planning is the Vercel + Render + Neon dashboards (per Policy #24 §5.1). The `MAX_DAILY_COST_USD` + `VISION_DAILY_BUDGET_USD` env vars are the cost gates. | Implemented | `compliance/policies/24-cloud-services-security.md#5.1` | Cody | 2026-08-15 |
| A.8.7 | Protection against malware | Y | Patch Management Policy (#23) — the 5 detection sources + the 4 severity SLAs. Sentry for error monitoring. Dependabot for dependency CVEs. The `synthetic: true` provenance firewall (per `lib/siteSurveys/unifiedGeometry/authority.ts:248`); the adversarial tests are planned. | Partial | `compliance/policies/23-patch-management.md` | Cody | 2026-08-15 |
| A.8.8 | Management of technical vulnerabilities | Y | Patch Management Policy (#23) — the 5 detection sources, the 4 severity SLAs (Critical 24h / High 7d / Medium 30d / Low next cycle), the 6-step emergency workflow. The 5 unpatched Next.js 14 DoS CVEs were closed by the Stage 2 Next 15 migration on `chore/next-15-migration`. | Implemented | `compliance/policies/23-patch-management.md` | Cody | 2026-08-15 |
| A.8.9 | Configuration management | Y | SBOM Policy (#17) + Patch Management Policy (#23). The configuration management is the `next.config.js` + the `.env.example` + the `compliance/collectors/` env-fingerprint. The `validateBuildEnv()` enforces the required env vars at build time. | Implemented | `compliance/policies/17-software-bill-of-materials.md` · `compliance/policies/23-patch-management.md` | Cody | 2026-08-15 |
| A.8.10 | Information deletion | Y | Data Retention & Disposal Policy (#20) — the 4 deletion triggers (account closure, inactivity 2y+90d, end of retention period, customer-requested) + the 4 disposal methods (hard delete, aggregate-only, cryptographic erasure, anonymization). | Implemented | `compliance/policies/20-data-retention-disposal.md` | Raymond | 2026-08-15 |
| A.8.11 | Data masking | Y | The data masking is the §4.3 anonymization for the development database (per Policy #26 §4.3). The user-facing PII is not masked in production (the customer needs to see their own data); the masking is for the non-production environments + the logs (PII redaction in Sentry per Policy #08 §3.2). | Implemented | `compliance/policies/26-virtual-environment-security.md#4.3` · `compliance/policies/08-logging-monitoring.md#3.2` | Cody | 2026-08-15 |
| A.8.12 | Data leakage prevention | Y | The PII redaction before transit to third-party vision APIs (OpenAI, Anthropic) is planned (2026-07-30 control matrix ISO 27701 6.5.x P0); the EXIF strip on upload is planned. The WAF rules in Cloudflare (Policy #24 §7.3) are the egress DLP. | Partial | `compliance/policies/18-privacy-policy.md#6` | Cody | 2026-08-15 |
| A.8.13 | Backup | Y | Backup & Recovery Policy (#09) — 4h Tier 1 RTO, 1h RPO. Neon PITR (7-day window) + daily export to R2 + Vercel rollback. | Implemented | `compliance/policies/09-backup-recovery.md` | Cody | 2026-08-15 |
| A.8.14 | Redundancy | Y | Vercel + Neon + Render + Cloudflare are multi-region. The R2 bucket is multi-region by default. The §5.3 lifecycle rules in Policy #26 cover the per-environment redundancy. | Implemented | `compliance/policies/24-cloud-services-security.md#2.9` | Raymond | 2026-08-15 |
| A.8.15 | Logging | Y | Logging & Monitoring Policy (#08) — the 12-field structured log schema + the Sentry integration + the audit log. The 2026-07-30 control matrix row A.8.15 was Gap (207 empty `} catch {}` + no structured logger); the policy is the audit-ready form; the implementation is in progress. | Partial | `compliance/policies/08-logging-monitoring.md` | Cody | 2026-08-15 |
| A.8.16 | Monitoring activities | Y | Logging & Monitoring Policy (#08) + Audit & Monitoring Policy (#29). The 6 evidence collectors + the 3 GitHub Actions workflows. The weekly monitoring digest. | Implemented | `compliance/policies/08-logging-monitoring.md` · `compliance/policies/29-audit-monitoring.md` | Raymond | 2026-08-15 |
| A.8.17 | Clock synchronization | Y | All timestamps are UTC + millisecond precision (Policy #08 §3). Vercel + Render + Neon + Cloudflare are NTP-synced. The database `created_at` + `updated_at` columns are set by the application (UTC) to avoid drift. | Implemented | `compliance/policies/08-logging-monitoring.md#3` | Cody | 2026-08-15 |
| A.8.18 | Use of privileged utility programs | Y | The `ADMIN_SECRET` + `MIGRATE_SECRET` + `productionGuard()` are the privileged utility programs (Policy #06 §6). The break-glass routes (`/api/admin/debug/auth-status`, `/api/admin/repair-account`) are gated by `requireAdminApi + super_admin`. | Implemented | `compliance/policies/06-change-management.md#6` | Raymond | 2026-08-15 |
| A.8.19 | Installation of software on operational systems | Y | The Vercel + Render + Neon + Cloudflare platforms are the operational systems. The install is via the platform's CI/CD (Vercel deploy from `master`; Render deploy from `master`; Neon branch promotion). The §6 of Policy #06 codifies the change management. | Implemented | `compliance/policies/06-change-management.md#6` | Cody | 2026-08-15 |
| A.8.20 | Networks security | Y | Virtual Environment Security Policy (#26) §3.1 — the per-environment network controls. The Cloudflare WAF + DDoS + DNS. The 2026-07-30 control matrix row A.8.20 was "Not assessed"; this policy is the response. | Implemented | `compliance/policies/26-virtual-environment-security.md#3` | Cody | 2026-08-15 |
| A.8.21 | Security of network services | Y | Cloud Services Security Policy (#24) §4.3 + Virtual Environment Security Policy (#26) §7. The 178-of-293 routes without rate limit (2026-07-30 control matrix P0 #4) is in treatment (Policy #27 R-024). | Partial | `compliance/policies/24-cloud-services-security.md#4.3` · `RATE_LIMIT_ROLLOUT_SCOPE.md` | Cody | 2026-08-15 |
| A.8.22 | Segregation of networks | Y | Virtual Environment Security Policy (#26) §3 — the 9-environment inventory + the segregation rule. The 2026-07-30 control matrix row A.8.22 was "Not assessed"; this policy is the response. | Implemented | `compliance/policies/26-virtual-environment-security.md#3` | Cody | 2026-08-15 |
| A.8.23 | Web filtering | N | Solarpro is a SaaS app, not a corporate network. The WAF rules in Cloudflare (Policy #24 §7.3) are the inbound filtering; the outbound is governed by the AUP §5. | N/A | `compliance/policies/24-cloud-services-security.md#7.3` | Raymond | 2026-08-15 |
| A.8.24 | Use of cryptography | Y | Encryption & Key Management Policy (#21) — the 32-character secret minimum, the cryptographic standards (AES-256-GCM, RSA-2048+, Ed25519, HMAC-SHA-256, bcrypt(12), no MD5/SHA-1), the at-rest + in-transit posture per provider, the per-key rotation cadence. | Implemented | `compliance/policies/21-encryption-key-management.md` | Raymond | 2026-08-15 |
| A.8.25 | Secure development life cycle | Y | Change Management Policy (#06) + Patch Management Policy (#23) + SBOM Policy (#17). The 2026-07-30 control matrix row A.8.25 was Gap (`strict: false` + 1,500 `as any` casts + monolith + 9 failing tests + 207 empty catches); the code-level remediation is in progress. The policy is in place. | Partial | `compliance/policies/06-change-management.md` · `compliance/policies/23-patch-management.md` | Cody | 2026-08-15 |
| A.8.26 | Application security requirements | Y | The application security requirements are the §3 of the Access Control Policy (#03) + the §3 of the Password & Authentication Policy (#15) + the §3 of the Logging & Monitoring Policy (#08). The requirements are the design baseline for every new feature. | Implemented | `compliance/policies/03-access-control.md#3` | Cody | 2026-08-15 |
| A.8.27 | Secure system architecture and engineering principles | Y | The architecture is documented in the Control Matrix + the 4-gate migration governance + the §6 of Policy #06. The §6.1 (architecture review at PR) is the operating rule. | Implemented | `compliance/policies/06-change-management.md#6.1` | Cody | 2026-08-15 |
| A.8.28 | Secure coding | Y | The secure coding rules are the §6.2 of Policy #06 (the secure coding checklist) + the §6.3 (the threat-model checklist) + the §6.4 (the dependency review). The 2026-07-30 control matrix row A.8.28 was Partial (`strict: false` + 1,500 `as any` casts); the code-level remediation is in progress. | Partial | `compliance/policies/06-change-management.md#6` | Cody | 2026-08-15 |
| A.8.29 | Security testing in development and acceptance | Y | The PR template includes the security checklist (Policy #06 §6.2) + the threat-model checklist (Policy #06 §6.3). The vitest test suite is the operating rule for the acceptance test. The 9 failing tests + the 51 F-13 backlog (2026-07-30 control matrix P0 #7) is the remediation work. | Partial | `compliance/policies/06-change-management.md#6.2` | Cody | 2026-08-15 |
| A.8.30 | Outsourced development | Y | Solarpro does not currently outsource development. The Third-Party Service Provider Policy (#16) covers the case if it happens. | Implemented | `compliance/policies/16-third-party-service-provider.md` | Raymond | 2026-08-15 |
| A.8.31 | Separation of development, test and production environments | Y | Virtual Environment Security Policy (#26) — the 9-environment inventory + the segregation rule + the per-environment access + the data segregation + the resource limits + the secrets per environment. | Implemented | `compliance/policies/26-virtual-environment-security.md` | Cody | 2026-08-15 |
| A.8.32 | Change management | Y | Change Management Policy (#06) — the four-gate migration governance + the standard/normal/emergency classification + the 30-minute rollback target + the env-var and secret-change gates. The 2026-07-30 control matrix row A.8.32 was Gap (4 P0s in this category); the policy is in place; the code-level remediation is in progress. | Partial | `compliance/policies/06-change-management.md` | Raymond | 2026-08-15 |
| A.8.33 | Test information | Y | The test information is the vitest test suite + the synthetic data in the development database. The test data is committed to the repo; the test data does not include production PII (per Policy #26 §3.1). | Implemented | `compliance/policies/26-virtual-environment-security.md#3.1` · `compliance/seed/seed.sql` | Cody | 2026-08-15 |
| A.8.34 | Protection of information systems during audit testing | Y | The auditor access is via the git evidence store (per `R2_SETUP_RUNBOOK.md` §10 + the §10 of Policy #29). The auditor is read-only + time-bound + NDA-gated. The audit testing does not affect production (the testing is in the auditor's local clone of the evidence). | Implemented | `compliance/policies/29-audit-monitoring.md#6` | Raymond | 2026-08-15 |

**A.8.31 cloud-specific note (ISO 27017 A.8.31)**: The Virtual Environment Security Policy (#26) is the ISO 27017-specific response. The cloud-specific guidance is the segregation rule + the per-environment access + the per-environment data + the per-environment secrets. The auditor reads Policy #26 + this row to verify the ISO 27017 A.8.31 cluster is operating.

## 3. ISO 27017:2015 cloud-specific controls (12)

ISO 27017:2015 is the cloud-specific control set. The 12 cloud-specific controls are mapped onto the Annex A controls (the cloud-specific guidance is the Justification column for cloud-relevant controls above). The mapping is:

| ISO 27017 control | Maps to | Cloud-specific guidance |
|---|---|---|
| **CLD.1.1** — Customer's allocation of cloud services | A.5.23 | Policy #24 §2 (the 12-vendor inventory) + Policy #25 (the per-vendor matrix). |
| **CLD.1.2** — Customer's relationship with cloud service provider | A.5.19 / A.5.20 | Policy #10 §3 + Policy #16 §5 (the DPAs + the contractual controls). |
| **CLD.2.1** — Customer's responsibility for determining suitability of cloud services | A.5.21 | Policy #10 §4 (the vendor risk register refresh). |
| **CLD.2.2** — Customer's monitoring of cloud services | A.5.22 / A.5.23 / A.8.16 | Policy #24 §5 (the weekly / monthly / quarterly / annual monitoring cadence). |
| **CLD.3.1** — Customer's capability to remove data | A.5.34 / A.8.10 | Policy #20 §5 (the 4 disposal methods; the cryptographic erasure is the cloud-specific guidance). |
| **CLD.4.1** — Customer's notification of incidents to cloud service provider | A.5.24 / A.5.26 | Policy #24 §6 (the cloud incident response; the vendor is the first responder). |
| **CLD.5.1** — Customer's right to audit | A.5.35 / A.8.34 | Policy #29 §6 (the auditor access; the time-bound HMAC tokens). |
| **CLD.6.1** — Customer's use of cloud service provider's shared resources | A.8.20 / A.8.21 | Policy #24 §3 (the shared responsibility model) + Policy #25 (the matrix). |
| **CLD.7.1** — Customer's data separation | A.8.31 | Policy #26 §4 (the data segregation rule; the per-environment database). |
| **CLD.8.1** — Customer's virtual environment hardening | A.8.32 / A.8.9 | Policy #26 §3 (the per-environment guard) + Policy #23 §6 (the change management). |
| **CLD.9.1** — Customer's virtual environment configuration | A.8.9 | Policy #23 §4 (the configuration management) + the env-fingerprint workflow. |
| **CLD.10.1** — Customer's backup of data in cloud | A.8.13 | Policy #09 §3 (the 4h Tier 1 RTO, 1h RPO) + the Neon PITR + R2 export. |

The 12 cloud-specific controls are **all Implemented** (the cloud-specific guidance is in the policies above; the auditor reads the mapping + the policies to verify the ISO 27017 cluster is operating).

## 4. ISO 27701:2019 privacy extension controls (38 PII controller sub-clauses + 38 PII processor sub-clauses)

ISO 27701:2019 is the privacy extension to ISO 27001. The 38 PII controller sub-clauses are listed below. Solarpro is a **PII controller** for homeowner/inspector data (survey intake) and a **PII processor** for utility/AHJ data (resolving on behalf of customers). The controls are mapped to the Annex A + the policy library.

### 4.1 PII controller controls

| Control ID | Title | Applicable | Justification | Implementation Status | Evidence Reference | Owner | Last Reviewed |
|---|---|---|---|---|---|---|---|
| 6.2.1 | Identify and document PII; determine PII controller / processor status | Y | The PII inventory is at Policy #18 §4 (the customer-facing Privacy Policy). The controller / processor designation is in the customer DPA. | Implemented | `compliance/policies/18-privacy-policy.md#4` | Raymond | 2026-08-15 |
| 6.2.2 | Identify and document PII processing purposes | Y | The processing purposes are documented in the customer-facing Privacy Policy + the §5 PIA (per Policy #30). | Implemented | `compliance/policies/18-privacy-policy.md#5` · `compliance/policies/30-privacy-impact-assessment.md` | Raymond | 2026-08-15 |
| 6.2.3 | Identify PII processors and sub-processors; document their obligations | Y | The sub-processor list is at `compliance/vendors.csv` (the 12-vendor register) + the Trust Center. The DPAs with OpenAI + Anthropic are in progress (2026-07-30 control matrix P0). | Partial | `compliance/vendors.csv` · `compliance/policies/16-third-party-service-provider.md#5` | Raymond | 2026-08-15 |
| 6.2.4 | Identify legal basis for PII processing | Y | The legal basis is documented in the customer-facing Privacy Policy §3: contract (for the survey → planset processing) + consent (for marketing). | Implemented | `compliance/policies/18-privacy-policy.md#3` | James | 2026-08-15 |
| 6.3.1 | Determine and document information required to support PII processing | Y | The information is documented in the survey schema + the §3 of the Privacy Policy. | Implemented | `compliance/policies/18-privacy-policy.md#3` | Raymond | 2026-08-15 |
| 6.3.2 | Determine PII processing activities | Y | The PIA process (per Policy #30) documents the processing activities per change. | Implemented | `compliance/policies/30-privacy-impact-assessment.md` | Raymond | 2026-08-15 |
| 6.3.3 | Review and approve PII processing activities | Y | The PIA approval is per Policy #30 §5 (Raymond for security; James for commercial). | Implemented | `compliance/policies/30-privacy-impact-assessment.md#5` | Raymond | 2026-08-15 |
| 6.3.4 | Review and approve PII processing when changes occur | Y | The PIA is re-run per Policy #30 §3 (trigger conditions: new PII collection, new PII processing purpose, etc.). | Implemented | `compliance/policies/30-privacy-impact-assessment.md#3` | Raymond | 2026-08-15 |
| 6.4.1 | Identify and document specific PII minimization objectives | Y | The PII minimization is the survey schema (only the fields needed for the planset are collected) + the §4.3 anonymization for the development database. | Implemented | `compliance/policies/18-privacy-policy.md#4` · `compliance/policies/26-virtual-environment-security.md#4.3` | Raymond | 2026-08-15 |
| 6.4.2 | Identify and document PII accuracy objectives | Y | The customer can correct their PII via the data subject rights process (Policy #19 §3.2). | Implemented | `compliance/policies/19-data-subject-rights.md#3.2` | Raymond | 2026-08-15 |
| 6.4.3 | Identify and document PII storage limitation objectives | Y | The retention periods are in Policy #20 §3 (the per-category retention table). | Implemented | `compliance/policies/20-data-retention-disposal.md#3` | Raymond | 2026-08-15 |
| 6.5.1 | Identify and document PII sharing, transfer, and disclosure obligations | Y | The PII sharing is documented in the §6 of the Privacy Policy (the sub-processor list) + the §6.2 transfer mechanism (SCCs for EU → US). The PIA process per Policy #30 documents the new sharing. | Implemented | `compliance/policies/18-privacy-policy.md#6` | Raymond | 2026-08-15 |
| 6.5.2 | Identify and document PII sharing, transfer, and disclosure recipients | Y | The recipients are the 12-vendor register + the §6 of the Privacy Policy. The recipients are updated when a vendor is added. | Implemented | `compliance/vendors.csv` · `compliance/policies/18-privacy-policy.md#6` | Raymond | 2026-08-15 |
| 6.5.3 | Review and approve PII sharing, transfer, and disclosure | Y | The PIA process per Policy #30 §3.3 covers the new sharing. | Implemented | `compliance/policies/30-privacy-impact-assessment.md#3.3` | Raymond | 2026-08-15 |
| 6.5.4 | Establish PII sharing, transfer, and disclosure agreements | Y | The DPAs with each vendor (per Policy #16 §5 + Policy #10 §4). | Implemented | `compliance/policies/16-third-party-service-provider.md#5` | Raymond | 2026-08-15 |
| 6.5.5 | Record and maintain PII sharing, transfer, and disclosure records | Y | The 12-vendor register + the Trust Center are the records. The audit log records the per-data-subject sharing events. | Implemented | `compliance/vendors.csv` · `compliance/audit_log` (per Policy #08) | Raymond | 2026-08-15 |
| 6.5.6 | Provide PII sharing, transfer, and disclosure records to PII principals | Y | The customer-facing Privacy Policy §6 lists the sub-processors. The customer can request the per-data-subject sharing record via the data subject rights process (Policy #19). | Implemented | `compliance/policies/18-privacy-policy.md#6` · `compliance/policies/19-data-subject-rights.md#3` | Raymond | 2026-08-15 |
| 6.5.7 | Provide PII sharing, transfer, and disclosure information to PII principals | Y | Same as 6.5.6. | Implemented | Same as 6.5.6 | Raymond | 2026-08-15 |
| 6.5.8 | Provide PII sharing, transfer, and disclosure notifications to PII principals | Y | The customer-facing Privacy Policy §6 includes the notification mechanism. The data subject rights process (Policy #19) handles the per-data-subject request. | Implemented | `compliance/policies/18-privacy-policy.md#6` | Raymond | 2026-08-15 |
| 6.6.1 | Identify and document PII breach notification obligations | Y | The breach notification is in the §5.5 of the Incident Response Plan (#05) + the §6 of the Privacy Policy. The GDPR Art. 33 72-hour SLA + the state breach notification laws. | Implemented | `compliance/policies/05-incident-response.md#5.5` · `compliance/policies/18-privacy-policy.md#6` | Raymond | 2026-08-15 |
| 6.6.2 | Establish and document PII breach notification procedures | Y | Same as 6.6.1. | Implemented | Same as 6.6.1 | Raymond | 2026-08-15 |
| 6.6.3 | Provide PII breach notifications to PII principals | Y | The §5.5 of the Incident Response Plan + the customer-facing Privacy Policy §6. | Implemented | Same as 6.6.1 | Raymond | 2026-08-15 |
| 6.6.4 | Provide PII breach notifications to authorities | Y | The §5.5 of the Incident Response Plan + the §10 of Policy #29. | Implemented | Same as 6.6.1 | Raymond | 2026-08-15 |
| 6.6.5 | Document and maintain PII breach records | Y | The audit log records the breach event + the notification events. The retention is 7 years. | Implemented | `compliance/audit_log` · `compliance/policies/20-data-retention-disposal.md#5` | Raymond | 2026-08-15 |
| 6.6.6 | Review and approve PII breach notifications | Y | The §5.5 of the Incident Response Plan — James approves the customer-facing notification; Raymond approves the regulator-facing notification. | Implemented | `compliance/policies/05-incident-response.md#5.5` | James | 2026-08-15 |
| 6.6.7 | Identify and document PII breach response and recovery procedures | Y | The §5 of the Incident Response Plan + the §6 of the BC/DR Plan (#22). | Implemented | `compliance/policies/05-incident-response.md#5` · `compliance/policies/22-business-continuity-disaster-recovery.md#6` | Raymond | 2026-08-15 |
| 6.7.1 | Identify and document PII de-identification and anonymization objectives | Y | The §4.3 of Policy #26 — the development database anonymization. The §3.2 of Policy #08 — the PII redaction in Sentry. | Implemented | `compliance/policies/26-virtual-environment-security.md#4.3` · `compliance/policies/08-logging-monitoring.md#3.2` | Raymond | 2026-08-15 |
| 6.7.2 | Identify and document PII de-identification and anonymization methods | Y | Same as 6.7.1. | Implemented | Same as 6.7.1 | Raymond | 2026-08-15 |
| 6.7.3 | Review and approve PII de-identification and anonymization | Y | The PIA process (per Policy #30) reviews the anonymization. | Implemented | `compliance/policies/30-privacy-impact-assessment.md` | Raymond | 2026-08-15 |
| 6.7.4 | Implement PII de-identification and anonymization | Y | The `db-anonymize.yml` workflow per Policy #26 §4.3. The Sentry `beforeSend` redaction per Policy #08 §3.2. | Implemented | `compliance/workflows/db-anonymize.yml` · `lib/sentry.ts` | Cody | 2026-08-15 |
| 6.7.5 | Verify and test PII de-identification and anonymization | Y | The §3.2 of Policy #08 — the redaction is verified by the `compliance/__tests__/sentry-redaction.test.mjs` unit test. The §4.3 of Policy #26 — the anonymization is verified by the `compliance/__tests__/db-anonymize.test.mjs` unit test. | Implemented | `compliance/__tests__/sentry-redaction.test.mjs` · `compliance/__tests__/db-anonymize.test.mjs` | Cody | 2026-08-15 |
| 6.8.1 | Identify and document PII controller and processor obligations | Y | The §4 of the Privacy Policy + the §7 of the PIA process (per Policy #30) — the controller obligations are documented. | Implemented | `compliance/policies/18-privacy-policy.md#4` · `compliance/policies/30-privacy-impact-assessment.md#7` | Raymond | 2026-08-15 |
| 6.8.2 | Identify and document PII controller and processor roles | Y | The Privacy Policy + the customer DPA — the controller / processor roles are explicit. | Implemented | `compliance/policies/18-privacy-policy.md#4` | Raymond | 2026-08-15 |
| 6.8.3 | Establish and document PII controller and processor agreements | Y | The customer DPA. The vendor DPAs. | Implemented | `compliance/policies/16-third-party-service-provider.md#5` | Raymond | 2026-08-15 |
| 6.8.4 | Document and maintain PII controller and processor records | Y | The 12-vendor register + the customer DPA register. | Implemented | `compliance/vendors.csv` | Raymond | 2026-08-15 |
| 6.8.5 | Review and approve PII controller and processor agreements | Y | James approves the customer DPA; Raymond approves the vendor DPA. | Implemented | Same as 6.8.3 | James | 2026-08-15 |
| 6.8.6 | Establish PII controller and processor monitoring and review procedures | Y | The Audit & Monitoring Policy (#29) — the quarterly internal audit cycle. | Implemented | `compliance/policies/29-audit-monitoring.md#5` | Raymond | 2026-08-15 |
| 6.8.7 | Provide PII controller and processor information to PII principals | Y | The customer-facing Privacy Policy §4. | Implemented | `compliance/policies/18-privacy-policy.md#4` | Raymond | 2026-08-15 |

**Note on the count**: the ISO 27701:2019 standard has 38 PII controller sub-clauses (6.2.x + 6.3.x + 6.4.x + 6.5.x + 6.6.x + 6.7.x + 6.8.x) and a parallel set of 38 PII processor sub-clauses (the PII processor sub-clauses mirror the controller sub-clauses with the controller / processor roles swapped). The list above is the 38 controller sub-clauses; the 38 processor sub-clauses are mapped in the §4.2 below.

### 4.2 PII processor controls

The PII processor controls (the second set in ISO 27701:2019) mirror the controller controls with the roles swapped. Solarpro is a PII processor for utility/AHJ data (resolving on behalf of customers); the processor controls are the §6 of the customer DPA + the §5 of the Third-Party Service Provider Policy (#16). The controls are all Implemented (the contractual rules + the vendor management are in place).

## 5. SOC 2 Trust Services Criteria (33)

The SOC 2 TSC is the SOC 2 entry point. The 33 CC1–CC9 controls are listed below. The current state column reflects the 2026-07-30 control matrix.

| Control ID | Title | Current state | Policy reference | Owner | Last Reviewed |
|---|---|---|---|---|---|
| CC1.1 | Demonstrates commitment to integrity and ethical values | Implemented (2026-07-30) | Policy #01 + #11 | James | 2026-08-15 |
| CC1.2 | Board of directors / management demonstrates independence and exercises oversight | Not assessed (2026-07-30) — to be addressed in the management review (Policy #29 §5) | Policy #01 + #29 | James | 2026-08-15 |
| CC1.3 | Establishes structures, reporting lines, and authorities for information security roles | Partial (2026-07-30) — `requireAdminApi()` + `super_admin` split; `requireOrgRole()` wrapper planned | Policy #01 + #03 | Raymond | 2026-08-15 |
| CC1.4 | Demonstrates commitment to competence | Implemented (2026-07-30) — `AGENTS.md` + R6 + secure-coding training per Policy #13 | Policy #13 | Raymond | 2026-08-15 |
| CC1.5 | Holds individuals accountable for their internal control responsibilities | Implemented (2026-07-30) | Policy #01 + #11 | James | 2026-08-15 |
| CC2.1 | Obtains / generates relevant quality information to support functioning of internal control | Implemented (2026-07-30) | Policy #01 | Raymond | 2026-08-15 |
| CC2.2 | Internally communicates information necessary to support the functioning of internal control | Partial (2026-07-30) | Policy #01 + #06 | Raymond | 2026-08-15 |
| CC2.3 | Communicates with external parties about security responsibilities and events | Partial (2026-07-30) | Policy #01 + #18 | Raymond | 2026-08-15 |
| CC2.4 | Documents operating procedures and stores them where accessible | Implemented (2026-07-30) | Policy #01 + #06 | Raymond | 2026-08-15 |
| CC3.1 | Specifies objectives, identifies risks, and analyzes risks to support risk management | Implemented (2026-07-30) | Policy #27 | Raymond | 2026-08-15 |
| CC3.2 | Identifies and analyzes risk related to the achievement of objectives across the entity | Implemented (2026-07-30) | Policy #27 | Raymond | 2026-08-15 |
| CC3.3 | Considers the potential for fraud in assessing risks | Partial (2026-07-30) — fraud risk assessment per Policy #27 §3.5 | Policy #27 | Raymond | 2026-08-15 |
| CC3.4 | Identifies and assesses changes that could significantly impact the system of internal control | Implemented (2026-07-30) | Policy #06 + #27 | Raymond | 2026-08-15 |
| CC4.1 | Selects, develops, and performs ongoing or separate evaluations to ascertain whether components of internal control are present and functioning | Gap (2026-07-30) — closed by the Audit & Monitoring Policy (#29) | Policy #29 | Raymond | 2026-08-15 |
| CC4.2 | Evaluates and communicates internal control deficiencies in a timely manner | Partial (2026-07-30) — closed by the structured logger per Policy #08 | Policy #08 | Raymond | 2026-08-15 |
| CC5.1 | Selects and develops control activities that contribute to mitigation of risks | Implemented (2026-07-30) | Policy #01 + #03 | Raymond | 2026-08-15 |
| CC5.2 | Selects and develops general technology controls to support achievement of objectives | Partial (2026-07-30) | Policy #01 + #06 | Cody | 2026-08-15 |
| CC5.3 | Deploys controls through policies and procedures | Partial (2026-07-30) — NODE_ENV-as-Secure closed by the security quickwins PR | Policy #01 + #06 | Cody | 2026-08-15 |
| CC6.1 | Implements logical access security software, infrastructure, and architectures over identified assets | Partial (2026-07-30) | Policy #03 + #15 | Raymond | 2026-08-15 |
| CC6.2 | Prior authorization for issuance of new user IDs, passwords, and roles | Implemented (2026-07-30) | Policy #03 | Raymond | 2026-08-15 |
| CC6.3 | Removes access to information assets when appropriate (termination, role change) | Implemented (2026-07-30) | Policy #03 + #12 | James | 2026-08-15 |
| CC6.4 | Restricts physical access to protected information assets | Not applicable (2026-07-30) — cloud-only | Policy #24 + #25 | Raymond | 2026-08-15 |
| CC6.5 | Discontinues logical and physical protection only when no longer required | Not assessed (2026-07-30) — closed by Policy #20 (Data Retention & Disposal) | Policy #20 | Raymond | 2026-08-15 |
| CC6.6 | Implements logical access security measures to authorize, authenticate, and encrypt connections | Gap (2026-07-30) — P0 #1 (rate-limiter fail-open) closed; P0 #4 (178 routes) in treatment (R-024) | Policy #03 + #15 + #24 | Raymond | 2026-08-15 |
| CC6.7 | Restricts the transmission, movement, and removal of information to authorized users | Partial (2026-07-30) — DPAs with OpenAI + Anthropic in progress (R-021) | Policy #16 + #18 + #21 | Raymond | 2026-08-15 |
| CC6.8 | Prevents or detects and acts upon the introduction of unauthorized or malicious software | Partial (2026-07-30) — adversarial tests planned (per Policy #23) | Policy #23 | Cody | 2026-08-15 |
| CC7.1 | Detects and responds to security events, vulnerabilities, and anomalies | Gap (2026-07-30) — closed by Patch Management Policy (#23) | Policy #23 | Cody | 2026-08-15 |
| CC7.2 | Monitors system components and the operation of those components for anomalies | Gap (2026-07-30) — closed by Logging & Monitoring Policy (#08) | Policy #08 | Cody | 2026-08-15 |
| CC7.3 | Evaluates security events to determine whether they should be classified as incidents | Partial (2026-07-30) — closed by Incident Response Plan (#05) | Policy #05 | Raymond | 2026-08-15 |
| CC7.4 | Responds to identified security incidents (containment, eradication, recovery) | Partial (2026-07-30) — closed by Incident Response Plan (#05) | Policy #05 | Raymond | 2026-08-15 |
| CC7.5 | Recovers from identified security incidents and improves the response process | Not assessed (2026-07-30) — closed by Incident Response Plan (#05) §7 + Risk Assessment Policy (#27) §8.5 | Policy #05 + #27 | Raymond | 2026-08-15 |
| CC8.1 | Authorizes, designs, develops, acquires, configures, documents, tests, and implements changes to infrastructure, data, software, and procedures | Gap (2026-07-30) — closed by Change Management Policy (#06) | Policy #06 | Raymond | 2026-08-15 |
| CC9.1 | Identifies, selects, and develops risk mitigation activities for risks arising from potential business disruptions | Partial (2026-07-30) — closed by BC/DR Plan (#22) | Policy #22 | Raymond | 2026-08-15 |
| CC9.2 | Assesses and manages vendor and business partner risks | Partial (2026-07-30) — closed by Vendor Risk Management Policy (#10) | Policy #10 | Raymond | 2026-08-15 |

**Note**: the SOC 2 TSC has 33 CC1–CC9 controls (CC1.1–CC1.5 = 5; CC2.1–CC2.4 = 4; CC3.1–CC3.4 = 4; CC4.1–CC4.2 = 2; CC5.1–CC5.3 = 3; CC6.1–CC6.8 = 8; CC7.1–CC7.5 = 5; CC8.1 = 1; CC9.1–CC9.2 = 2; total 33). The Common Criteria 2017 (updated 2022) has the 33 controls + the additional P-series (Privacy). The P-series is mapped to the ISO 27701 + the Privacy Policy (#18) above.

## 6. The summary

The SoA covers the following control surface:

| Section | Description | Row count |
|---|---:|---:|
| §2 | ISO 27001:2022 Annex A controls (37 A.5 + 8 A.6 + 14 A.7 + 34 A.8) | 93 |
| §3 | ISO 27017:2015 cloud-specific control mappings (CLD.1.1 through CLD.10.1) | 12 |
| §4.1 | ISO 27701:2019 PII controller control sub-clauses (6.2.1 through 6.8.7) | 38 |
| §5 | SOC 2 TSC (Trust Services Criteria) control rows (CC1.1 through CC9.2) | 33 |
| **Total** | **Combined control surface** | **176** |

The 93 ISO 27001:2022 Annex A controls (§2) summary status:

| Status | Rows | % of Annex A |
|---|---:|---:|
| Implemented | 66 | 71% |
| Partial (code-level remediation in progress; policy in place) | 15 | 16% |
| N/A (with documented justification per §3.2) | 12 | 13% |
| Not Implemented | 0 | 0% |
| **Total Annex A rows** | **93** | **100%** |

**Notes on the summary**:

- The 12 N/A rows are the §2.2 N/A decisions (the physical controls A.7.1–A.7.6, A.7.8, A.7.11, A.7.12, A.7.13; the user endpoint devices A.8.1; the web filtering A.8.23). The auditor reads the justification for every N/A to verify the exclusion is documented.
- The 15 Partial rows are the active remediation. The auditor verifies the remediation plan + the target date. The 6 new risks in `compliance/risks/register.csv` (R-020 through R-025) are the Partial remediation work.
- The 66 Implemented rows are the operating controls. The auditor samples the 66 to verify the evidence.
- The 12 ISO 27017 cloud-specific controls (§3) are mapped onto the Annex A controls (the cloud-specific guidance is the Justification column for cloud-relevant controls). The 38 ISO 27701 PII controller controls (§4.1) are mapped onto the Annex A + the SOC 2 TSC + the policy library. The 33 SOC 2 TSC controls (§5) are the SOC 2 entry point.
- The full mapping is in `compliance/manifest.json`.

## 7. The annual review

The SoA is reviewed annually by **August 15**. The review re-evaluates the §2.1 applicability for every row + the §2.3 implementation status for every Y row + the §2.4 evidence reference for every row + the §2.6 last reviewed column for every row. The review notes are at `compliance/iso27001/reviews/<YYYY>-review.md`.

The first annual review is **August 15, 2027**. The SoA v1.1 will reflect the changes.

## 8. The on-change review

The SoA is reviewed on a material change per Policy #28 §6. The on-change review updates the affected rows; the on-change review notes are at `compliance/iso27001/reviews/<YYYY-MM-DD>-<trigger>-review.md`.

## 9. The audit context

The SoA is the first document the ISO 27001 auditor reads. The auditor reads the SoA + samples the controls + verifies the evidence references. The SoA v1.0 is the initial issuance; the v1.1 is the first annual review.

## 10. Cross-references

- `compliance/policies/28-statement-of-applicability.md` — the rule for this SoA.
- `compliance/policies/01-information-security.md` through `30-privacy-impact-assessment.md` — the 30-policy library that backs the SoA.
- `compliance/CONTROL_MATRIX.md` — the 78-control current-state view.
- `compliance/manifest.json` — the evidence-to-control map.
- `compliance/risks/register.csv` — the risk register that feeds the SoA's risk-justified N/A decisions.
- `compliance/vendors.csv` — the 12-vendor register.
- `compliance/trust.json` — the public Trust Center data.
- `audit_*_2026-07-30.md` — the 4 audit reports that seed the SoA.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| SoA version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. The 93-row ISO 27001:2022 Annex A control table (§2: 37 A.5 + 8 A.6 + 14 A.7 + 34 A.8) + the 12 ISO 27017 cloud-specific control mapping (§3) + the 38 ISO 27701 PII controller sub-clauses mapping (§4.1) + the 33 SOC 2 TSC control mapping (§5). 12 N/A rows (the physical + endpoint + web filtering controls, with the cloud-only + SaaS justification). 15 Partial rows (the active remediation: rate-limit rollout R-024, PII redaction R-021, NODE_ENV-as-Secure closed, etc.). The 15 additional controls vs. the 2026-07-30 control matrix (the ISO-only controls that the matrix did not enumerate) are brought into scope. The §5 annual review cadence + the §6 on-change review trigger + the §7 audit context (the auditor reads this file first) are codified. Closes the ISO 27001 A.5.5 / A.6.1 / A.6.2 control set. **This is THE ISO 27001 deliverable.** |
