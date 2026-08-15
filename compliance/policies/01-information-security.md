# Information Security Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-001 — Information Security Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro systems, employees, contractors, and third parties with access to Solarpro data or systems |

---

## 1. Purpose

This policy is the foundation of Solarpro's information security program. Every other policy in `compliance/policies/` references this one. It sets the security objectives, the roles, the risk management approach, and the review cadence that the rest of the program operates against.

## 2. Scope

This policy applies to:

- **People**: all Solarpro employees, contractors, and any third party granted access to Solarpro systems or data.
- **Systems**: every production system, every non-production environment that touches production data, and every endpoint (laptop, phone) used to access those systems. Today: Next.js on Vercel, Neon Postgres, Render (Python SAM2 service), GitHub, Google Workspace, Cloudflare.
- **Data**: all data Solarpro holds on behalf of itself, its customers, and its customers' end users (homeowners, inspectors, AHJs).

Out of scope: physical data center controls. Solarpro has no on-prem footprint; physical security is inherited from Vercel, Neon, and Render's SOC 2 reports (see `compliance/vendors.csv`).

## 3. Security objectives

Solarpro protects information across five dimensions. The order matters — confidentiality and integrity take priority over convenience.

1. **Confidentiality** — information is accessible only to people who are authorized to see it. Customer PII (homeowner names, addresses, photos) and credentials are the highest bar.
2. **Integrity** — information is accurate and unaltered. Engineering outputs (plan-sets, BOMs) bound by hash to permit-snapshot digests, so any tampering is detectable.
3. **Availability** — systems are operational when needed. Recovery targets are documented in the Business Continuity & Disaster Recovery policy (Sprint 2).
4. **Privacy** (ISO 27701 add-on) — PII is collected for documented purposes, retained for the minimum time needed, and respected as a data-subject right. See the Data Classification & Handling Policy and the Data Subject Rights Policy (Sprint 2).
5. **Compliance** — Solarpro operates in line with SOC 2 Trust Services Criteria, ISO 27001:2022, ISO 27701:2019, and ISO 27017:2015. The control matrix at `compliance/CONTROL_MATRIX.md` is the source of truth for which controls are implemented, partial, or gap.

## 4. Roles and responsibilities

This section is the **SOC 2 CC1.3 evidence**. Roles are explicit because a 3-person startup has no room for implicit ownership.

| Role | Person | Responsibilities |
|---|---|---|
| **Founder / CEO / Management sign-off** | **James Carpenter** | Final approver for every policy. Signs off on the risk register annually. Owns vendor relationships above the threshold in the Vendor Risk Management policy. Cannot be bypassed. |
| **CISO / Security point** | **Raymond O'Brien** | Owns the security program day-to-day. Approves access exceptions. Runs the incident response plan when it triggers. Reviews the weekly monitoring digest. Author of the technical security decisions. Has `super_admin` role in the app and the infra. |
| **Technical lead** | **Cody** | Implements security controls. No oversight role. No access to customer PII outside what his work requires. Reports security findings to Raymond. |

If a role is vacant for more than 30 days, the remaining two execute the duties. James retains the sign-off role. Raymond's CISO duties fall to James until filled.

External parties handling Solarpro data (sub-processors listed in `compliance/vendors.csv`) are governed by signed DPAs and reviewed quarterly.

## 5. Risk management approach

Solarpro runs a **lightweight, quarterly risk cycle** scaled to a 3-person team:

1. **Identify** — Raymond maintains the risk register at `compliance/CONTROL_MATRIX.md` §"Risk register." New risks are added when identified.
2. **Assess** — each risk gets a likelihood and impact rating. Inherent risk is calculated; residual risk is calculated after the controls in the matrix are applied.
3. **Treat** — risks above the appetite threshold (Medium) get a remediation plan with an owner and a target date. Risks below are accepted.
4. **Monitor** — the weekly monitoring workflow at `compliance/monitoring/` flags drift (new Dependabot high-severity alerts, failed-login spikes, etc.). Quarterly UAR (`compliance/uar/`) reviews access state.
5. **Review** — James signs off the risk register annually, or sooner if a Sev1 incident lands.

The 78 controls in the matrix are graded **Implemented / Partial / Gap / Not Applicable / Not assessed**. A "Gap" without a remediation date is a control deficiency that must be either fixed or formally accepted by James with a written rationale.

## 6. Compliance framework

Solarpro is audited against four standards in parallel:

| Framework | Status | Target |
|---|---|---|
| **SOC 2 Type 1** | Audit in flight | Q4 2026 (RE+ posture) |
| **SOC 2 Type 2** | Observation period begins after Type 1 | 2027 |
| **ISO 27001:2022** | Stage 1 audit | Q1 2027 |
| **ISO 27701:2019** | Privacy extension to 27001 | Q2 2027 |
| **ISO 27017:2015** | Cloud-specific controls | Q2 2027 |

Self-built evidence collection (see `compliance/SELF_BUILT_SETUP.md`) replaces a compliance platform for year 1. The system is designed so that migrating to Vanta or Drata in year 2 is a config change, not a rewrite.

## 7. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond.
- **On material change** — within 30 days of any of: a Sev1 incident, a new sub-processor handling PII, a change in role assignments, a new framework in scope, or a change in ownership of more than 25% of the company.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 8. Exceptions

Any exception to a control in this policy or any subordinate policy must be:

1. **Documented** in a Linear issue (or, if no Linear, a GitHub issue) tagged `compliance-exception`.
2. **Approved by Raymond** (CISO) with a stated duration (max 90 days without re-approval).
3. **Disclosed to James** if the exception involves a P0 control, a Sev1-classified incident, or any control tied to a customer commitment.

Verbal exceptions are not exceptions.

## 9. Enforcement

Failure to follow this policy or any subordinate policy is handled by:

- **First occurrence, no customer impact**: coaching + a written note in the personnel file.
- **Repeated or willful violation, or any violation with customer impact**: access suspension, then HR review.
- **Willful malicious action**: termination + legal review.

## 10. Related documents

- `compliance/CONTROL_MATRIX.md` — 78 controls, evidence sources, current state.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection, R2 bucket, weekly monitoring.
- `compliance/PROGRAM.md` — the program plan and Sprint timeline.
- `compliance/policies/02-acceptable-use.md` through `05-incident-response.md` — subordinate policies.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. |
