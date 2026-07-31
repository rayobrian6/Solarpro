# Solarpro Policy Library

This directory holds Solarpro's information security and privacy policies. Policies are **versioned in git**, **drafted in markdown**, and **signed off** by Raymond O'Brien (CISO) and James Carpenter (CEO) before they take effect.

The library is the **SOC 2 + ISO 27001 + 27701 + 27017 evidence** for "we have written, approved, and operate against documented policies." Each policy cross-references the specific controls it satisfies; the canonical control mapping lives in `compliance/CONTROL_MATRIX.md`.

## Sprint 1 — Foundation (drafted 2026-08-15, awaiting signature)

These five are the foundation. Every other policy references them.

| # | Policy | File | Owner | Approver | Last reviewed | Next review | Controls |
|---|---|---|---|---|---|---|---|
| 01 | Information Security Policy | [01-information-security.md](./01-information-security.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.1, CC1.2, CC1.3 · ISO 27001 A.5.1, A.5.2 |
| 02 | Acceptable Use Policy | [02-acceptable-use.md](./02-acceptable-use.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC1.4, CC1.5 · ISO 27001 A.5.10 |
| 03 | Access Control Policy | [03-access-control.md](./03-access-control.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.1, CC6.2, CC6.3 · ISO 27001 A.5.15, A.5.16, A.5.18, A.8.2, A.8.5 |
| 04 | Data Classification & Handling Policy | [04-data-classification-handling.md](./04-data-classification-handling.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC6.7, CC6.8 · ISO 27001 A.5.12, A.5.13 · ISO 27701 PII controls |
| 05 | Incident Response Plan | [05-incident-response.md](./05-incident-response.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.3, CC7.4, CC7.5 · ISO 27001 A.5.24–A.5.29 |

## Sprint 1 — Operations cluster (drafted 2026-08-15, awaiting signature)

These five are the operations layer. They cover how changes ship, how vulnerabilities are managed, what gets logged, how data is recovered, and how third parties are managed. They close three of the 2026-07-30 P0 audit findings: the Next 14 CVE finding (07), the 207 empty `} catch {}` finding (08), and the open Tier 1 DPA finding (10).

| # | Policy | File | Owner | Approver | Last reviewed | Next review | Controls |
|---|---|---|---|---|---|---|---|
| 06 | Change Management Policy | [06-change-management.md](./06-change-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC8.1 · ISO 27001 A.8.9, A.8.25, A.8.28, A.8.32 |
| 07 | Vulnerability Management Policy | [07-vulnerability-management.md](./07-vulnerability-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.1 · ISO 27001 A.8.8, A.8.16 |
| 08 | Logging & Monitoring Policy | [08-logging-monitoring.md](./08-logging-monitoring.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC7.2 · ISO 27001 A.8.15, A.8.16 |
| 09 | Backup & Recovery Policy | [09-backup-recovery.md](./09-backup-recovery.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.1 · ISO 27001 A.8.13 |
| 10 | Vendor Risk Management Policy | [10-vendor-risk-management.md](./10-vendor-risk-management.md) | Raymond O'Brien (CISO) | James Carpenter | 2026-08-15 | 2027-08-15 | SOC 2 CC9.2 · ISO 27001 A.5.19, A.5.20, A.5.21, A.5.23 · ISO 27017 A.5.23 |

## How to use this library

- **Reading order**: start with policy 01. Every other policy references it.
- **During onboarding** (when headcount grows): the AUP, Access Control, and Data Classification policies are the must-reads.
- **For auditors**: each policy's "Related documents" section links to the relevant `CONTROL_MATRIX.md` rows and to the evidence sources in `compliance/SELF_BUILT_SETUP.md`.
- **For James**: the policy approval signatures are placeholders until you and Raymond sign. See `REVIEW_PROCESS.md` for how to do that.

## How a policy gets added or changed

See [`REVIEW_PROCESS.md`](./REVIEW_PROCESS.md). The summary:

1. A policy change is a **pull request**. The PR body must describe the change, the reason, and the controls affected.
2. **Raymond reviews** the technical accuracy.
3. **James approves** and merges.
4. The merge commit SHA becomes the audit artifact of the change.
5. The policy's "Revision history" table is updated in the same PR.

## Status legend

- **Drafted** — written, not yet signed. Current status of all 10 policies (5 foundation + 5 operations).
- **Signed** — both signatures collected. Effective date applies.
- **Superseded** — replaced by a newer version. The file stays in git for the audit trail.

## Sprint 2 — to be drafted

The full 30-policy target is in `compliance/PROGRAM.md` §5. 10 of 30 are now drafted (5 foundation + 5 operations). The remaining 20 are scoped for Sprint 2 (2026-09-03 → 2026-10-15). See `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` for the remaining 20, the gap to the auditor, and the CISO-review process.

## Related documents

- `compliance/CONTROL_MATRIX.md` — 78 controls, current state, evidence sources.
- `compliance/PROGRAM.md` — program plan and Sprint timeline.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture.
- `compliance/policies/REVIEW_PROCESS.md` — how policies get reviewed and approved.
- `HANDOFF_COMPLIANCE_POLICIES_V1.md` — Sprint 1 foundation handoff.
- `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` — Sprint 1 operations handoff (this batch).
