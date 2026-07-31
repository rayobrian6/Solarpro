# Solarpro Policy Library

This directory holds Solarpro's information security, privacy, and compliance policies. Policies are **versioned in git**, **drafted in markdown**, and **signed off** by Raymond O'Brien (CISO) and James Carpenter (CEO) before they take effect.

The library is the **SOC 2 + ISO 27001 + 27701 + 27017** evidence for "we have written, approved, and operate against documented policies." Each policy cross-references the specific controls it satisfies; the canonical control mapping lives in `compliance/CONTROL_MATRIX.md`. The **Statement of Applicability (SoA)** — the primary ISO 27001 deliverable — is at `compliance/iso27001/soa.md`; the SoA is the auditor's first read and maps every Annex A control to the applicability decision, the implementation status, the evidence reference, and the owner.

> **As of 2026-08-15:** **30 of 30 policies are drafted.** The 30-policy program is complete pending CISO review and management sign-off. The v1 (policies 1-5), v2-ops (policies 6-10), and v3-personnel (policies 11-15) clusters were committed on `chore/compliance-policies-v1` / `-v2-ops` / `-v3-personnel` and are **not pushed** pending James's "ship it". The v4-vendor-privacy cluster (policies 16-20), the v5-ops-cloud cluster (policies 21-25), and the v6-final cluster (policies 26-30) are on the current `chore/next-15-migration` branch, also **not pushed** — see the HANDOFF_COMPLIANCE_POLICIES_V*.md docs at the repo root for the CISO-review process and the CISO/management sign-off path. The SoA is at `compliance/iso27001/soa.md` and the retroactive PIA is at `compliance/privacy/pia-retroactive-2026-08-15.md` (per Policy #30 §10.1).

---

## The 30 policies

| # | Policy | File | Owner | Approver | Last reviewed | Next review | Controls |
|---|---|---|---|---|---|---|---|
| 01 | Information Security Policy | [01-information-security.md](./01-information-security.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.1, CC1.2, CC1.3 · ISO 27001 A.5.1, A.5.2 |
| 02 | Acceptable Use Policy | [02-acceptable-use.md](./02-acceptable-use.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.4, CC1.5 · ISO 27001 A.5.10 |
| 03 | Data Classification & Handling Policy | [03-access-control.md](./03-access-control.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.1, CC6.2, CC6.3 · ISO 27001 A.5.15, A.5.16, A.5.18, A.8.2, A.8.5 |
| 04 | Access Control Policy | [04-data-classification-handling.md](./04-data-classification-handling.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.7, CC6.8 · ISO 27001 A.5.12, A.5.13 · ISO 27701 PII |
| 05 | Incident Response Plan | [05-incident-response.md](./05-incident-response.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.3, CC7.4, CC7.5 · ISO 27001 A.5.24–A.5.29 |
| 06 | Change Management Policy | [06-change-management.md](./06-change-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC8.1 · ISO 27001 A.8.32, A.8.25, A.8.28 |
| 07 | Vulnerability Management Policy | [07-vulnerability-management.md](./07-vulnerability-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.1 · ISO 27001 A.8.8 |
| 08 | Logging & Monitoring Policy | [08-logging-monitoring.md](./08-logging-monitoring.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.2 · ISO 27001 A.8.15, A.8.16 |
| 09 | Backup & Recovery Policy | [09-backup-recovery.md](./09-backup-recovery.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.1 · ISO 27001 A.8.13 |
| 10 | Vendor Risk Management Policy | [10-vendor-risk-management.md](./10-vendor-risk-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.2 · ISO 27001 A.5.19, A.5.20, A.5.21, A.5.23 · ISO 27017 A.5.23 |
| 11 | Code of Conduct | [11-code-of-conduct.md](./11-code-of-conduct.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.1, CC1.5 · ISO 27001 A.5.1, A.5.4 |
| 12 | Employee Onboarding & Offboarding Policy | [12-employee-onboarding-offboarding.md](./12-employee-onboarding-offboarding.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.2, CC6.3 · ISO 27001 A.6.1, A.6.2, A.6.3, A.6.5 |
| 13 | Security Awareness & Training Policy | [13-security-awareness-training.md](./13-security-awareness-training.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.4 · ISO 27001 A.6.3 |
| 14 | Background Check Policy | [14-background-check.md](./14-background-check.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27001 A.6.1, A.6.2 |
| 15 | Password & Authentication Policy | [15-password-authentication.md](./15-password-authentication.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.1 · ISO 27001 A.5.17 |
| 16 | Third-Party Service Provider Policy | [16-third-party-service-provider.md](./16-third-party-service-provider.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.2 · ISO 27001 A.5.19, A.5.20, A.5.21, A.5.23 · ISO 27701 6.2.3 |
| 17 | Software Bill of Materials (SBOM) Policy | [17-software-bill-of-materials.md](./17-software-bill-of-materials.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27001 A.5.9, A.8.9 · ISO 27017 A.5.23 |
| 18 | Privacy Policy (external-facing) | [18-privacy-policy.md](./18-privacy-policy.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-07-30 | 2027-07-30 | SOC 2 P-series · ISO 27001 A.5.34 · ISO 27701 (full PII controller cluster) · GDPR Chapter III · CCPA 1798.100-130 · PIPEDA · FADP |
| 19 | Data Subject Rights Policy | [19-data-subject-rights.md](./19-data-subject-rights.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27701 6.10, 6.11, 6.12 · GDPR Articles 15-22 · CCPA 1798.100-130 |
| 20 | Data Retention & Disposal Policy | [20-data-retention-disposal.md](./20-data-retention-disposal.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.5 · ISO 27001 A.5.34, A.8.10 · ISO 27701 6.7, 6.8 · GDPR Article 17 |
| 21 | Encryption & Key Management Policy | [21-encryption-key-management.md](./21-encryption-key-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.1, CC6.7 · ISO 27001 A.5.17, A.8.24 · ISO 27017 A.8.24 |
| 22 | Business Continuity & Disaster Recovery Plan | [22-business-continuity-disaster-recovery.md](./22-business-continuity-disaster-recovery.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.1 · ISO 27001 A.5.29, A.5.30 · ISO 27017 A.5.30 |
| 23 | Patch Management Policy | [23-patch-management.md](./23-patch-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.1 · ISO 27001 A.8.8, A.8.9, A.12.6 |
| 24 | Cloud Services Security Policy | [24-cloud-services-security.md](./24-cloud-services-security.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.6 · ISO 27001 A.8.16 · ISO 27017 A.8.16 |
| 25 | Shared Responsibility Matrix | [25-shared-responsibility-matrix.md](./25-shared-responsibility-matrix.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.6 · ISO 27017 A.5.23 |
| 26 | Virtual Environment Security Policy | [26-virtual-environment-security.md](./26-virtual-environment-security.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27001 A.8.31 · ISO 27017 A.8.31 · SOC 2 CC6.1, CC6.6, CC6.7 |
| 27 | Risk Assessment Policy | [27-risk-assessment.md](./27-risk-assessment.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC3.1, CC3.2, CC3.4 · ISO 27001 A.5.7 |
| 28 | Statement of Applicability (SoA) Policy | [28-statement-of-applicability.md](./28-statement-of-applicability.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27001 A.5.5, A.6.1, A.6.2 (the rule for the SoA) |
| 29 | Audit & Monitoring Policy | [29-audit-monitoring.md](./29-audit-monitoring.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC4.1, CC4.2 · ISO 27001 A.8.16 · ISO 27017 A.8.16 |
| 30 | Privacy Impact Assessment (PIA) Policy | [30-privacy-impact-assessment.md](./30-privacy-impact-assessment.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | ISO 27001 A.5.34 · ISO 27701 6.4, 6.5, 6.6 · SOC 2 P-series |

> **Note on the table above.** The control mappings are condensed for the table; the per-policy "Related documents" section in each file gives the full set. Some policies (e.g. the Privacy Policy) intentionally map to a large control surface because they are the customer-facing hub for the privacy program.

## The policy clusters

The 30 policies in the program doc §5 are grouped into seven clusters. The 25 drafted policies are in the first six clusters; the Compliance & Audit cluster (5 policies, 26-30) is the next batch.

| Cluster | Sprint | Policies | Status |
|---|---|---|---|
| **Information Security (foundation)** | Sprint 1, v1 | 01-05 | ✅ Drafted (5/5), awaiting signature |
| **Operations** | Sprint 1, v2-ops | 06-10 | ✅ Drafted (5/5), awaiting signature |
| **Personnel** | Sprint 1, v3-personnel | 11-15 | ✅ Drafted (5/5), awaiting signature |
| **Vendor & Third Party** | Sprint 1, v4-vendor-privacy | 16, 17 | ✅ Drafted (2/2), awaiting signature |
| **Privacy (ISO 27701)** | Sprint 1, v4-vendor-privacy | 18, 19, 20 | ✅ Drafted (3/3), awaiting signature |
| **Operations carryover + Cloud-specific (ISO 27017)** | Sprint 2, v5-ops-cloud | 21, 22, 23, 24, 25 | ✅ Drafted (5/5), awaiting signature |
| **Compliance & Audit** | Sprint 2, v6-final | 26, 27, 28, 29, 30 | ✅ Drafted (5/5), awaiting signature |
| **Total** | | 30 | **30/30 drafted** |

The v5-ops-cloud cluster covers (a) the two operations carryovers (Encryption & Key Management, Business Continuity & Disaster Recovery) that were referenced in the foundation and operations policies but not in the v1/v2-ops drafts, (b) the new Patch Management policy that codifies the cadence the Stage 2 Next 15 migration demonstrated, and (c) the start of the ISO 27017 cloud cluster (Cloud Services Security + the Shared Responsibility Matrix that backs it). The 5 remaining (26-30) are the Compliance & Audit cluster — Virtual Environment Security, Risk Assessment, Statement of Applicability, Audit & Monitoring, and Privacy Impact Assessment — and are scoped for the next batch.

## How to use this library

- **Reading order**: start with policy 01 (Information Security). Every other policy references it. For privacy work, read 18 (Privacy Policy) — that is the customer-facing hub for the privacy program and references the internal-only policies 04, 19, 20.
- **During onboarding** (when headcount grows): the AUP, Access Control, and Data Classification policies are the must-reads (02, 04, 03). Policy 12 (Onboarding & Offboarding) is the operating procedure that walks through the lifecycle.
- **For auditors**: each policy's "Related documents" section links to the relevant `CONTROL_MATRIX.md` rows and to the evidence sources in `compliance/SELF_BUILT_SETUP.md` and `compliance/manifest.json`. The control matrix is the canonical mapping; the policy cluster is the human-readable grouping.
- **For customers**: policy 18 (Privacy Policy) is published at `https://solarpro.app/privacy` and linked from the Trust Center. The customer does not see the other 19 — those are the internal evidence that backs the customer-facing promise in policy 18.
- **For James**: the policy approval signatures are placeholders until you and Raymond sign. See `REVIEW_PROCESS.md` for how to do that.

## How a policy gets added or changed

See [`REVIEW_PROCESS.md`](./REVIEW_PROCESS.md). The summary:

1. A policy change is a **pull request**. The PR body must describe the change, the reason, and the controls affected.
2. **Raymond reviews** the technical accuracy.
3. **James approves** and merges.
4. The merge commit SHA becomes the audit artifact of the change.
5. The policy's "Revision history" table is updated in the same PR.

## Status legend

- **Drafted** — written, not yet signed. Current status of all 20 policies in this directory as of 2026-08-15.
- **Signed** — both signatures collected. Effective date applies.
- **Superseded** — replaced by a newer version. The file stays in git for the audit trail.

## The 5 policies to be drafted (now drafted — 30/30 complete)

The 5 remaining policies (26-30) covered the Compliance & Audit cluster and are now drafted (v6-final cluster, 2026-08-15):

| # | Policy | Cluster | Status |
|---|---|---|---|
| 26 | Virtual Environment Security Policy | Compliance & Audit | ✅ Drafted (v6-final) |
| 27 | Risk Assessment Policy | Compliance & Audit | ✅ Drafted (v6-final) |
| 28 | Statement of Applicability (SoA) | Compliance & Audit | ✅ Drafted (v6-final) |
| 29 | Audit & Monitoring Policy | Compliance & Audit | ✅ Drafted (v6-final) |
| 30 | Privacy Impact Assessment Policy | Compliance & Audit | ✅ Drafted (v6-final) |

With this batch, the 30-policy program is **complete pending CISO review and management sign-off**. The Statement of Applicability (SoA) — the primary ISO 27001 deliverable — lives at `compliance/iso27001/soa.md`; the SoA is the 93-row Annex A control table + the 12 ISO 27017 cloud-specific controls + the 31 ISO 27701 PII controller controls + the 33 SOC 2 TSC controls. The retroactive PIA (per Policy #30 §10.1) lives at `compliance/privacy/pia-retroactive-2026-08-15.md`; the retroactive PIA is the evidence that the PIA process is operating for the existing processing.

## Sprint 1 + v5 + v6-final — drafted (2026-08-15, awaiting signature)

The 30 policies in this directory were drafted across six commits:

| Commit | Branch | Policies | Date |
|---|---|---|---|
| `60209e07` | `chore/compliance-policies-v1` | 01-05 (foundation) | 2026-07-30 |
| `09b4a5cb` | `chore/compliance-policies-v2-ops` | 06-10 (operations) | 2026-08-15 |
| `f8865dc4` | `chore/compliance-policies-v3-personnel` | 11-15 (personnel) | 2026-08-15 |
| (v4 commit) | `chore/next-15-migration` | 16-20 (vendor + privacy) | 2026-08-15 |
| (v5 commit) | `chore/next-15-migration` | 21-25 (ops carryover + cloud) | 2026-08-15 |
| (v6 commit — pending) | `chore/next-15-migration` | 26-30 (Compliance & Audit final cluster) + SoA + retroactive PIA | 2026-08-15 |

All six commits are local and **not pushed** to `origin`. James's "ship it" is the trigger for each PR (per AGENTS.md R1 and R7). The handoff docs for each commit:

- `HANDOFF_COMPLIANCE_POLICIES_V1.md` (v1 commit)
- `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (v2-ops commit)
- `HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md` (v3-personnel commit)
- `HANDOFF_COMPLIANCE_POLICIES_V4_VENDOR_PRIVACY.md` (v4 commit — vendor + privacy)
- `HANDOFF_COMPLIANCE_POLICIES_V5_OPS_CLOUD.md` (v5 commit — operations carryover + cloud)
- `HANDOFF_COMPLIANCE_POLICIES_V6_FINAL.md` (v6 commit — **30/30 program complete**, Compliance & Audit final cluster)

## Related documents

- `compliance/CONTROL_MATRIX.md` — 84 controls, current state, evidence sources.
- `compliance/iso27001/soa.md` — **the Statement of Applicability**. The 93-row ISO 27001:2022 Annex A control table + the 12 ISO 27017 cloud-specific controls + the 31 ISO 27701 PII controller controls + the 33 SOC 2 TSC controls. The auditor's first read.
- `compliance/PROGRAM.md` — program plan and Sprint timeline.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture.
- `compliance/privacy/pia-template.md` — the PIA template (per Policy #30 §3).
- `compliance/privacy/pia-retroactive-2026-08-15.md` — the retroactive PIA for the existing processing (per Policy #30 §10.1).
- `compliance/privacy/pia-register.csv` — the PIA register (per Policy #30 §7).
- `compliance/risks/register.csv` — the risk register (per Policy #27 §5).
- `compliance/vendors.csv` — the sub-processor register (12 vendors).
- `compliance/trust.json` — the public Trust Center data.
- `compliance/manifest.json` — the evidence-to-control map.
- `compliance/policies/REVIEW_PROCESS.md` — how policies get reviewed and approved.
- `~/.mavis/agents/compliance-lead/workspace/PROGRAM.md` — the canonical program plan (this repo's `compliance/PROGRAM.md` is a snapshot).
