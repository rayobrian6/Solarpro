# Statement of Applicability Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-028 — Statement of Applicability (SoA) Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual), or on material change (new framework in scope, new control added to a framework, new vendor handling PII, material change to the Annex A control set in ISO 27001:2022) |
| **Scope** | Every ISO 27001:2022 Annex A control (93 controls in A.5–A.8); every ISO 27017:2015 cloud-specific control; the SOC 2 Trust Services Criteria; the ISO 27701:2019 privacy extension. The scope is the SoA artifact at `compliance/iso27001/soa.md`. The policy is the rule for the SoA; the SoA is the data. |

---

## 1. Purpose

This policy is the rule for **the Statement of Applicability (SoA)** — the document the ISO 27001 auditor reads first. The SoA is the mapping of every Annex A control to: applicable (Y/N), justification, implementation status, evidence reference, owner, and last reviewed. Without a current SoA, no ISO 27001 cert.

The SoA is the **ISO 27001 A.5.5 / A.6.1 / A.6.2** evidence (the policy + the role + the risk-assessment references). It is also the auditor's primary entry point: the auditor reads the SoA first, then samples the controls in the "Implemented" + "Partial" rows, then verifies the evidence references.

The SoA is the **companion document** to the control matrix. The control matrix (`compliance/CONTROL_MATRIX.md`) is the **current-state view** (78 controls with status, evidence, severity, remediation). The SoA is the **applicability view** (93 Annex A controls with the applicable Y/N + justification + status + evidence). The two are kept in sync; the SoA is the auditor-facing document; the matrix is the internal working document.

The SoA lives at **`compliance/iso27001/soa.md`** (per ISO 27001 convention — a separate document from the policies). This policy is the **rule for the SoA**: how the SoA is structured, who maintains it, when it is reviewed, and how it is versioned. The SoA itself is in the companion file.

The 2026-07-30 control matrix has 78 controls (SOC 2 + ISO + ISO 27701). The ISO 27001:2022 Annex A has **93 controls** (A.5.1–A.5.37 = 37 organizational; A.8.1–A.8.34 = 34 technological; the count is 93 in the published Annex A). The SoA at `compliance/iso27001/soa.md` covers all 93 + the 12 ISO 27017 cloud-specific controls (which map onto the Annex A controls; the cloud-specific guidance is the justification column). The 15 additional controls (the 93 minus the 78 in the matrix) are the ISO-only controls that the 2026-07-30 matrix did not enumerate because the matrix was SOC 2-led. The SoA brings the matrix to the full ISO 27001 Annex A scope.

## 2. The SoA structure

The SoA is a single table with one row per control. The columns are the ISO 27001:2022 minimum + the Solarpro extensions.

### 2.1 The required columns

The ISO 27001:2022 SoA requires four columns: **Control ID, Applicability (Y/N), Justification, Implementation Status**. The Solarpro extension adds three more: **Evidence Reference, Owner, Last Reviewed**. The seven columns are:

| Column | Type | Description | Example |
|---|---|---|---|
| **Control ID** | string | The Annex A control identifier. | `A.5.1` |
| **Title** | string | The Annex A control title. | `Policies for information security` |
| **Applicable (Y/N)** | enum | Whether Solarpro implements the control. Even if the control is N/A, the row is present. | `Y` |
| **Justification** | string | Why Solarpro is or is not implementing the control. For N/A controls: the rationale for exclusion. For Y controls: the scope of the implementation. | `Information Security Policy (#01) is the foundation of the program. Reviewed annually.` |
| **Implementation Status** | enum | One of: **Implemented** (control is fully operating + evidence is current), **Partial** (control is partially operating + remediation in progress), **Not Implemented** (control is not yet operating; a target date is set), **N/A** (control is excluded; justification is the reason). | `Implemented` |
| **Evidence Reference** | string | The file path or `compliance/manifest.json` path to the evidence. For N/A: "deferred — see risk register" or the rationale. | `compliance/policies/01-information-security.md` |
| **Owner** | string | The control owner; one of: James (CEO), Raymond (CISO), Cody (Tech Lead). | `Raymond` |
| **Last Reviewed** | date | The date the row was last reviewed. The annual review per §5 updates this. | `2026-08-15` |

### 2.2 The applicability column

The applicability is the **decision** to implement or exclude the control. The decision is per the §3 criteria.

A control marked **N/A** is still listed in the SoA. The auditor will read the justification for every N/A to verify the exclusion is documented and reasoned. A control marked **N/A** without a justification is an audit finding.

The 2026-07-30 control matrix had 3 "Not applicable" rows: CC6.4 (physical access — cloud-only), A.8.1 (user endpoint devices — cloud-only), A.8.23 (web filtering — Solarpro is a SaaS app, not a corporate network). The SoA at `compliance/iso27001/soa.md` carries those N/A rows + 4 additional N/A rows for the ISO 27001 controls that are similarly out of scope (e.g. A.5.24 physical security for the same reason; A.7 physical controls — N/A in ISO 27001:2022 since the physical controls are in A.7.1–A.7.14 but A.7 was not in scope; A.8.1 user endpoint devices — same as the existing row).

### 2.3 The justification column

The justification is the **reasoning** for the applicability decision. The justification is one to three sentences; the auditor reads the justification to verify the decision is grounded in the Solarpro risk profile, not a copy-paste from a template.

Examples:

- **Y** — "Information Security Policy is the foundation of the Solarpro security program; reviewed annually per §7 of Policy #01. See `compliance/policies/01-information-security.md`."
- **N/A** — "Cloud-only deployment; no on-prem footprint. The physical security of the data center is covered by the Vercel / Neon / Render SOC 2 reports (CC6.4 in the control matrix). Excluded from Solarpro's direct control scope."
- **Y — Partial** — "Backup & Recovery Policy (#09) is the documented policy; the PITR verification cadence is documented but not yet tested end-to-end. Remediation target: 2026-09-30."

### 2.4 The evidence reference column

The evidence reference is the **path to the evidence**. The path is one of:

- **A policy file path** — `compliance/policies/01-information-security.md` for the policy-driven controls.
- **A manifest path** — `compliance/manifest.json#/controls/A.5.1` for the control-matrix-driven controls.
- **A evidence file path** — `compliance/evidence/<integration>/<date>/<file>` for the collector-driven evidence.
- **A vendor file path** — `compliance/vendors.csv` for the vendor-driven controls.
- **A risk register path** — `compliance/risks/register.csv#R-024` for the risk-driven controls.
- **A "deferred" string** — `"deferred — see risk register"` for the controls that are not yet implemented but the risk is in the register.

The evidence reference is the **single source of truth** the auditor will check. The auditor will open the file, read the evidence, and verify the control is operating.

### 2.5 The owner column

The owner is the **single point of accountability** for the control. The owner is one of: James (CEO), Raymond (CISO), Cody (Tech Lead). The owner is the §5 reviewer for the row in the annual review.

The owner assignment follows the §7 of the Information Security Policy (#01) and the §7 of the Risk Assessment Policy (#27): James = commercial + management; Raymond = security + privacy + audit; Cody = technical + implementation. A control that crosses the boundary (e.g. an operational control with security implications) is owned by the security party (Raymond) with the technical party (Cody) as the implementer.

### 2.6 The last reviewed column

The last reviewed column is the **date the row was last touched**. The date is updated in the §5 annual review + the §6 on-change review. The auditor will read the dates to verify the cadence is operating; a row with a stale date is an audit finding.

## 3. Applicability criteria

The applicability decision is grounded in the §3.1–§3.5 criteria. The criteria are the **rule for the Y/N decision**; the auditor reads the criteria + the row to verify the decision is consistent.

### 3.1 The default

The default is **Y** (applicable). The Solarpro risk profile (a cloud-only SaaS handling customer PII, processing vision / payment / PII, subject to SOC 2 + ISO 27001 + 27701 + 27017) means the vast majority of the Annex A controls are applicable.

### 3.2 The N/A criteria

A control is marked **N/A** only if:

1. **The control is physically impossible to apply to Solarpro's situation.** Example: A.7.x physical controls (in the legacy ISO 27001:2013 numbering) or A.8.1 user endpoint devices — Solarpro is a cloud-only SaaS, no managed endpoints.
2. **The control is fully covered by a vendor's SOC 2 report.** Example: A.5.24 / A.7.x physical security of the data center — Vercel + Neon + Render SOC 2 reports cover this. The justification column names the vendor SOC 2 report.
3. **The control is explicitly excluded by management with a documented rationale.** Example: a control that is not feasible to implement at Solarpro's scale (e.g. a control that requires a dedicated security operations center). The justification column names the rationale + the §6.3 acceptance in the Risk Assessment Policy (#27).

A control marked N/A under (3) is reviewed annually in the §5 annual review; the rationale may change as Solarpro grows.

### 3.3 The Y — Partial criteria

A control is marked **Y — Partial** if:

1. **The policy is in place** (e.g. the encryption policy is written) **but the implementation is not complete** (e.g. not all secrets are rotated on the documented cadence).
2. **The implementation is in place** (e.g. the rate limiter is in the code) **but the test coverage is not complete** (e.g. not all routes have rate limits).
3. **The implementation is in place** (e.g. the access reviews are documented) **but the cadence is not operating** (e.g. the quarterly UAR has not been run yet).

A Y — Partial control has a remediation target date in the `Justification` column. The target date is ≤ 90 days for P0 controls (per the Risk Assessment Policy #27 §2.3); ≤ 180 days for P1 controls.

### 3.4 The Not Implemented criteria

A control is marked **Not Implemented** if:

1. **The policy is in place** (e.g. the privacy policy is written) **but the control has not been built yet** (e.g. the data export endpoint is not implemented).
2. **The control is in the design phase** (e.g. the key management policy is being written) **but has not been approved** (e.g. the policy is in draft).
3. **The control is approved but not yet operating** (e.g. the audit & monitoring policy is approved but the internal audit cadence has not started).

A Not Implemented control has a target date in the `Justification` column. The target date is in the next 6-12 months.

### 3.5 The re-evaluation criteria

The applicability decision is **re-evaluated** when:

- A new control is added to the Annex A (e.g. ISO 27001:2022 Amd 1 adds new controls for climate change + digital transformation).
- A new vendor joins the inventory (e.g. a new Tier 1 vendor changes the cloud-control applicability).
- A new framework is added to the scope (e.g. ISO 27701 was not in the original scope; the SoA now includes the 27701 controls).
- A material change to the Solarpro risk profile (e.g. Solarpro opens a new product line that handles a new data type).

The re-evaluation is a §5 annual review + a §6 on-change review.

## 4. The SoA companion file

The SoA is at **`compliance/iso27001/soa.md`**. The file is a single Markdown table with 93 rows (one per Annex A control) + the 12 ISO 27017 cloud-specific controls (which map onto the Annex A controls; the cloud-specific guidance is the justification column) + the SOC 2 TSC rows (the auditor-facing summary) + the ISO 27701 rows.

The companion file is the **canonical artifact**. The auditor reads the companion file directly. This policy is the rule; the companion file is the data.

The companion file is versioned in git. Every change to the companion file is a PR with Raymond's review (technical accuracy) and James's sign-off (management approval). The change is the §6 on-change review trigger; the change is reflected in the `Last Reviewed` column of every affected row.

## 5. Annual review

The SoA is reviewed annually. The annual review is the §5.1 cadence + the §5.2 output.

### 5.1 The cadence

The annual review is by **August 15 of each year**, in alignment with the Information Security Policy (#01) annual review. The review is led by Raymond (CISO); the participants are James + Raymond + Cody. The auditor (if engaged) is invited to observe the review for the first annual review; the auditor's feedback is incorporated.

### 5.2 The review tasks

The annual review includes:

1. **Re-evaluate the §3 applicability for every row.** The Y/N decision is verified; the justification column is updated if the conditions have changed.
2. **Re-evaluate the §2.3 implementation status for every Y row.** The Implemented / Partial / Not Implemented status is verified against the current state of the control matrix; the rows in the control matrix that are now Implemented are reflected in the SoA; the rows that have regressed are reflected.
3. **Update the §2.4 evidence reference for every row.** The evidence path is verified; stale references are updated; new evidence is added.
4. **Update the §2.6 last reviewed column for every row.** The date is the date of the annual review.
5. **Sign-off.** James + Raymond sign the SoA at the end of the review. The signature is the §8 approval signatures.

### 5.3 The annual review output

The output of the annual review is:

1. **The updated SoA** at `compliance/iso27001/soa.md` (the new version is committed to git with the §5.2 changes).
2. **The annual review notes** at `compliance/iso27001/reviews/<YYYY>-review.md`. The notes summarize the changes; the notes are signed by James + Raymond.
3. **The updated `compliance/manifest.json`** if the control IDs or evidence references changed.

## 6. On-change review

The SoA is reviewed on a **material change**. The on-change review is the §6.1 trigger + the §6.2 output.

### 6.1 The trigger

The on-change review is triggered by:

1. **A new control** added to ISO 27001:2022 Annex A (e.g. Amd 1, Amd 2, future amendments).
2. **A new vendor** added to the inventory (the §3.2 vendor SOC 2 report may change the N/A decision).
3. **A new framework** added to the scope (e.g. ISO 27701 — already in scope; a new framework would be e.g. FIPS 140-3 for a federal customer).
4. **A material change to the Solarpro risk profile** (e.g. a new product line, a new data type, a new customer segment).
5. **A material change to a vendor's posture** (e.g. a vendor SOC 2 report lapse, a vendor security incident).
6. **A new P0 audit finding** that affects the SoA.

The on-change review is led by Raymond (CISO) within 30 days of the trigger. The review updates the affected rows; the review is reflected in the next quarterly digest.

### 6.2 The output

The output of the on-change review is:

1. **The updated SoA** at `compliance/iso27001/soa.md` (the affected rows are updated; the rest of the table is unchanged).
2. **The on-change review notes** at `compliance/iso27001/reviews/<YYYY-MM-DD>-<trigger>-review.md`. The notes are signed by James + Raymond.

## 7. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the SoA. Maintains the companion file at `compliance/iso27001/soa.md`. Leads the §5 annual review + the §6 on-change review. Reviews the §3 applicability decisions for every row. Files the §5.3 review notes. |
| **Management sign-off** | **James Carpenter** | Approves the §3 applicability decisions (especially the N/A decisions). Signs off on the §5 annual review + the §6 on-change review. Approves changes to the §2.5 owner column. |
| **Technical lead** | **Cody** | Provides the §2.3 implementation status inputs (the current state of the control matrix). Implements the §6 on-change review updates that are technical. |
| **Auditor (when engaged)** | TBD (Schellman per `AUDITOR_SHORTLIST.md`) | Reviews the SoA as the first step of the audit. Provides feedback on the §3 applicability decisions. Verifies the §2.4 evidence references. |

## 8. Versioning

The SoA is **versioned in git** as `compliance/iso27001/soa.md`. The versioning follows the standard git + signed-commit pattern.

### 8.1 The commit pattern

Every change to the SoA is a **single commit** with a descriptive message. The commit message includes:

- The SoA version (e.g. `SoA v1.1 — annual review 2026-08-15`).
- The summary of the change (e.g. `Updated 12 rows from Partial to Implemented; added 2 new rows for ISO 27001:2022 Amd 1`).
- The §5.2 / §6.2 review note path (e.g. `See compliance/iso27001/reviews/2026-08-15-annual-review.md`).

The commit is signed off by Raymond (CISO) in the commit message + James (CEO) in the PR approval. The signed commit is the audit artifact.

### 8.2 The SoA version

The SoA version is a **semantic version** in the companion file's metadata header. The format is `MAJOR.MINOR`:

- **MAJOR** — incremented when a material change to the SoA structure (e.g. a new column, a new framework in scope) or a full re-issuance.
- **MINOR** — incremented when a row update (e.g. an applicability change, an evidence reference change, a status change).

The first issuance is **v1.0**. The first annual review is **v1.1**. A new framework in scope (e.g. FIPS 140-3) is **v2.0**.

### 8.3 The SoA history

The SoA history is the **git log of the companion file**. The history is the audit trail. The auditor reads the git log to verify the cadence is operating; a row with a stale `Last Reviewed` date is an audit finding.

## 9. SoA-to-policy cross-references

The SoA is the **auditor-facing document**; the policies are the **internal operating documents**. The cross-references are the links between them.

| SoA control | Policy | Notes |
|---|---|---|
| A.5.1 | Policy #01 | Information Security Policy |
| A.5.2 | Policy #01 §4 | Information security roles and responsibilities |
| A.5.7 | Policy #27 | Risk Assessment Policy |
| A.5.10 | Policy #02 | Acceptable Use Policy |
| A.5.12 | Policy #04 | Data Classification & Handling Policy |
| A.5.15 | Policy #03 | Access Control Policy |
| A.5.16 | Policy #03 | Access Control Policy |
| A.5.17 | Policy #15 | Password & Authentication Policy |
| A.5.18 | Policy #03 | Access Control Policy |
| A.5.19 | Policy #10 | Vendor Risk Management Policy |
| A.5.20 | Policy #10 | Vendor Risk Management Policy |
| A.5.21 | Policy #10 | Vendor Risk Management Policy |
| A.5.23 | Policy #24 + #25 | Cloud Services Security + Shared Responsibility Matrix |
| A.5.24 | Policy #05 | Incident Response Plan |
| A.5.25 | Policy #05 | Incident Response Plan |
| A.5.26 | Policy #05 | Incident Response Plan |
| A.5.27 | Policy #05 | Incident Response Plan |
| A.5.28 | Policy #08 | Logging & Monitoring Policy |
| A.5.29 | Policy #22 | Business Continuity & Disaster Recovery Plan |
| A.5.30 | Policy #22 | Business Continuity & Disaster Recovery Plan |
| A.5.31 | Policy #01 §6 | Legal, statutory, regulatory and contractual requirements |
| A.5.34 | Policy #18 + #19 | Privacy Policy + Data Subject Rights |
| A.5.35 | Policy #01 §5 + #29 | Independent review (the audit & monitoring) |
| A.5.36 | Policy #01 §5 | Compliance with policies |
| A.5.37 | Policy #06 | Documented operating procedures (change management) |
| A.8.1 | n/a (cloud-only) | User endpoint devices — N/A |
| A.8.2 | Policy #03 | Privileged access rights |
| A.8.3 | Policy #03 | Information access restriction |
| A.8.5 | Policy #15 | Secure authentication |
| A.8.7 | Policy #23 | Protection against malware |
| A.8.8 | Policy #23 | Management of technical vulnerabilities |
| A.8.9 | Policy #17 + #23 | Configuration management (SBOM + patch mgmt) |
| A.8.12 | Policy #08 + #18 | Data leakage prevention |
| A.8.15 | Policy #08 | Logging |
| A.8.16 | Policy #08 + #24 + #29 | Monitoring activities |
| A.8.20 | Policy #26 | Networks security |
| A.8.21 | Policy #06 + #24 | Security of network services |
| A.8.22 | Policy #26 | Segregation of networks |
| A.8.23 | n/a (SaaS) | Web filtering — N/A |
| A.8.24 | Policy #21 | Use of cryptography |
| A.8.25 | Policy #06 + #23 | Secure development life cycle |
| A.8.28 | Policy #06 + #23 | Secure coding |
| A.8.31 | Policy #26 | Virtual environment security (ISO 27017 specific) |
| A.8.32 | Policy #06 | Change management |
| A.8.34 | Policy #30 | Privacy Impact Assessment (during audits) |

The cross-reference table is in the companion file at `compliance/iso27001/soa.md` (in the rightmost column). The table is the **mapping from the SoA to the policy library**; the auditor reads the SoA + the policy library to verify the evidence.

## 10. The SoA in the audit context

The SoA is the **first document the ISO 27001 auditor reads**. The ISO 27001 audit process is:

1. **Read the SoA.** The auditor reads the SoA to understand which controls are in scope, which are applicable, and which are excluded.
2. **Sample the Implemented controls.** The auditor selects a sample of the Implemented controls and verifies the evidence reference.
3. **Sample the Partial + Not Implemented controls.** The auditor selects a sample of the Partial + Not Implemented controls and verifies the remediation plan.
4. **Sample the N/A controls.** The auditor selects a sample of the N/A controls and verifies the justification.
5. **Verify the cross-references.** The auditor verifies the SoA's cross-references to the policies + the evidence are correct.

The SoA is the **primary entry point** for the audit. The auditor's first finding is often a SoA row (e.g. an N/A without justification, a Partial without a remediation plan, a stale Last Reviewed date). The §5 annual review + the §6 on-change review are the **preventive controls** for those findings.

## 11. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review is aligned with the SoA's annual review (§5).
- **On material change** — within 30 days of any of: a new framework in scope, a new control added to ISO 27001:2022 Annex A, a material change to the SoA structure (e.g. a new column), a material change to the Solarpro risk profile.
- **After every ISO 27001 audit** — the auditor's feedback on the SoA is incorporated; the policy + the companion file are updated.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 12. Related documents

- `compliance/iso27001/soa.md` — **the SoA itself**. The 93-row Annex A control table + the 12 ISO 27017 rows + the SOC 2 TSC + the ISO 27701 rows. The canonical artifact. The auditor reads this file first.
- `compliance/policies/01-information-security.md` — the foundation; the §6 framework coverage.
- `compliance/policies/27-risk-assessment.md` — the risk register that feeds the SoA's risk-justified N/A decisions.
- `compliance/policies/29-audit-monitoring.md` — the audit cadence that the §10 references.
- `compliance/CONTROL_MATRIX.md` — the current-state view that the SoA's Implementation Status column reflects.
- `compliance/manifest.json` — the evidence-to-control map that the SoA's Evidence Reference column may reference.
- `compliance/iso27001/reviews/` — the §5.3 + §6.2 review notes.
- `compliance/vendors.csv` — the 12-vendor register that the §3.2 N/A decisions reference.
- `AUDITOR_SHORTLIST.md` — the auditor selection process (the §10 audit context).

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the SoA as the **primary ISO 27001 deliverable** at `compliance/iso27001/soa.md`; defines the 7-column structure (Control ID, Title, Applicable Y/N, Justification, Implementation Status, Evidence Reference, Owner, Last Reviewed), the §3 applicability criteria (default Y; N/A only for impossible / vendor-covered / management-accepted with rationale), the §5 annual review cadence (by August 15 each year, aligned with the Information Security Policy annual review), the §6 on-change review trigger (new control / new vendor / new framework / material change), the §7 roles (Raymond = CISO owner; James = management sign-off; Cody = technical input), the §8 versioning (semantic version, single-commit, signed by James + Raymond), the §9 SoA-to-policy cross-references, and the §10 SoA in the audit context. The companion file at `compliance/iso27001/soa.md` is the 93-row Annex A control table + the 12 ISO 27017 rows + the SOC 2 TSC + the ISO 27701 rows. The 15 additional controls (93 minus the 78 in the 2026-07-30 matrix) are the ISO-only controls that the matrix did not enumerate because the matrix was SOC 2-led. Closes the ISO 27001 A.5.5 / A.6.1 / A.6.2 control set. |
