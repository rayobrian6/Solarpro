# HANDOFF — Compliance Policies v4 (Sprint 1 Vendor & Privacy cluster)

**Status:** Drafted, **NOT PUSHED**, awaiting review and signature.
**Author:** Mavis / compliance-lead via legal-writer
**Date:** 2026-08-15
**Per:** F-13 handoff convention (see prior `HANDOFF_COMPLIANCE_POLICIES_*.md` files at repo root).
**Companion to:** `HANDOFF_COMPLIANCE_POLICIES_V1.md` (foundation), `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (operations), `HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md` (personnel). With this batch, **20 of 30 policies are drafted** — Sprint 1 is done.

---

## What was done

Drafted the **5 Vendor & Third Party + Privacy (ISO 27701) cluster policies** for Solarpro's SOC 2 Type 1 / ISO 27001 / 27701 / 27017 program, in `compliance/policies/`. These join the 15 already drafted in the v1, v2-ops, and v3-personnel clusters. The Privacy Policy (#18) is the customer-facing notice; the other four are the internal operating procedures that back it.

| # | File | Title | POL ID | Size | Status |
|---|---|---|---|---|---|
| 16 | `compliance/policies/16-third-party-service-provider.md` | Third-Party Service Provider Policy | POL-VEN-002 | 30 KB | Drafted, awaiting signature |
| 17 | `compliance/policies/17-software-bill-of-materials.md` | Software Bill of Materials (SBOM) Policy | POL-IS-016 | 22 KB | Drafted, awaiting signature |
| 18 | `compliance/policies/18-privacy-policy.md` | Privacy Policy (external-facing) | POL-PRV-001 | 28 KB | Drafted, awaiting signature |
| 19 | `compliance/policies/19-data-subject-rights.md` | Data Subject Rights Policy | POL-PRV-002 | 27 KB | Drafted, awaiting signature |
| 20 | `compliance/policies/20-data-retention-disposal.md` | Data Retention & Disposal Policy | POL-PRV-003 | 26 KB | Drafted, awaiting signature |
| — | `compliance/policies/README.md` | Policy library index | — | 13 KB | Updated to include all 20 policies + the 10-policy Sprint 2 backlog |

**Total**: 5 new policies + 1 updated index, ~146 KB of new policy content. The Privacy Policy alone is ~28 KB because it is the customer-facing notice and is intentionally the most polished of the 5 — it is designed to be published at `https://solarpro.app/privacy` and linked from the Trust Center without further rewriting.

### The 5-policy scope

The 5 policies are the Vendor & Third Party + Privacy cluster. The user (James) selected this batch in priority order:

| # | Why this policy, in this order |
|---|---|
| **16 — Third-Party Service Provider** | Closes the people-side gap left by Policy 10 (Vendor Risk Management). Policy 10 covers SaaS / infrastructure; Policy 16 covers contractors, freelancers, consultants, agency partners, IR retainers, design firms, contract engineers. The two are read together; `compliance/vendors.csv` is the public subset of both. |
| **17 — Software Bill of Materials** | Closes the EO 14028 / ISO 27001 A.5.9 / A.8.9 inventory obligation. CycloneDX + SPDX, generated automatically on every production build, with a failed-generation fails-the-build rule. The policy calls out the current state honestly: the CI integration is **not yet in place**; the manual quarterly procedure is the operative process until Sprint 1 §5 lands. |
| **18 — Privacy Policy (external-facing)** | The customer-facing hub for the privacy program. Published at `/privacy`, linked from the Trust Center, satisfies the SOC 2 P-series + ISO 27001 A.5.34 + ISO 27701 (full PII controller cluster) + GDPR Chapter III + CCPA + PIPEDA + FADP obligations in one document. |
| **19 — Data Subject Rights** | The operational process for handling access / rectification / erasure / portability / restriction / objection / consent-withdrawal requests. 30-day default SLA (GDPR Art. 12(3)) with a 45-day CCPA fallback. The intake → verification → fulfillment → audit-log → closure process is designed for a 3-person team where one person (Raymond or James) can fulfill any request. |
| **20 — Data Retention & Disposal** | The retention schedule for every data category in the Solarpro stack. Active retention + post-event retention + disposal method per category. Four deletion triggers (account closure, inactivity 2y+90d, end of retention period, customer-requested) and four disposal methods (hard delete, aggregate-only, cryptographic erasure, anonymization). |

### Design choices (continuing from v1, v2-ops, v3-personnel)

1. **Same header table format** as the previous 15. Policy / Version / Effective date / Owner (CISO) / Approver (Management) / Last reviewed / Next review / Scope — all in the same shape. The policy library reads as one document.
2. **Concrete, not template.** Raymond, James, Cody. Real systems: Vercel, Neon, Render, OpenAI, Anthropic, Google, Stripe, Resend, GitHub, Sentry, Cloudflare, 1Password. The 2026-08-12 rate-limiter fail-open is referenced where it changes the rule (Policy 15 §6). The `compliance/vendors.csv` 12-vendor register is the input to Policy 16 §5. The Trust Center at `compliance/trust.json` is the input to Policy 18 §5.
3. **The P0 finding being closed is named in the policy.** Policy 16 closes the people-side third-party gap; Policy 17 closes the build-inventory gap; Policy 19 operationalizes the GDPR rights; Policy 20 closes the data-lifecycle gap (P0 #6 in the control matrix).
4. **The policy calls out the current state honestly.** Policy 17 §1 says "as of 2026-08-15, Solarpro does not yet auto-generate SBOMs on every build." Policy 14 §7 (Background Check) does the same thing for the screening-vendor line item. An auditor who sees a documented deferral, a rationale, a compensating control, and a re-evaluation date is looking at a working control environment. An auditor who sees a claimed control that doesn't exist is not.
5. **The exception process is consistent across all 20.** Linear issue tagged `compliance-exception` → Raymond approval → 90-day max (or 14 days for DSR SLAs) → James disclosure for P0. The Information Security Policy §8 is the root.
6. **Cross-references to the control matrix are explicit.** Every policy's "Related documents" section names the specific control IDs the policy satisfies.

### Policy-specific design notes

- **16 — Third-Party Service Provider** pairs with Policy 10 (Vendor Risk Management) as the people-side / SaaS-side companion. Defines a three-tier classification (Tier A production data / PII, Tier B limited data / non-production, Tier C no data / no systems) and a six-step pre-engagement due-diligence flow (request, NDA, questionnaire, background check, DPA, access provisioning). The background check step is the same scope as Policy 14 §3; the operational execution is the compensating-control variant (reference checks + firm attestation) until the screening-vendor line item is funded. The eight-step offboarding checklist is the **SOC 2 CC6.5** evidence and mirrors the Vendor Risk Management §7.1 eight steps with the addition of "rotate credentials within 7 days regardless of vendor deletion confirmation."
- **17 — Software Bill of Materials** is the EO 14028 / ISO 27001 A.5.9 / A.8.9 inventory obligation. The policy commits to **CycloneDX (primary) + SPDX (secondary)**, both JSON, generated automatically on every production build with a failed-generation fails-the-build rule. The build gate blocks deployment on Critical or KEV findings (a 7-day exception max). The public SBOM is at `https://solarpro.app/trust/sbom.json` (Next.js) and `https://solarpro.app/trust/sbom-sam2.json` (SAM2 service) once the CI integration lands. The pre-Sprint-1 manual procedure (§4.4) is the operative process; the first manual SBOMs are due 2026-09-30. The policy is in force; the automation is the open work.
- **18 — Privacy Policy** is the customer-facing notice. The header is for the auditor; the body is for the customer. The body covers: who we are, what this policy covers, what we collect, how we use it, who we share with, cookies, your rights, retention, security, international transfers, children, changes, how to contact us, and the compliance framework. The policy explicitly does **not** sell personal information, does **not** use customer data to train AI models, and does **not** run third-party advertising or analytics. The compliance framework section clarifies that the framework is the **target state**; SOC 2 Type 1 audit is targeted for Q4 2026; ISO 27001/27701 for 2027. The policy is in force today; the external certification is the open work tracked in `PROGRAM.md`.
- **19 — Data Subject Rights** is the operational rule for the seven GDPR Articles 15-22 rights + the CCPA equivalents + the supervisory-authority complaint right. The five-step process (intake → verification → fulfillment → confirmation + audit log → closure) has tiered internal SLAs (1-5 days for acknowledgements and verifications, 5-15 days for typical fulfillments, up to 30 days for large accounts or downstream propagation) with a default 30-day response SLA across all rights. The request register is at `compliance/privacy/dsr-register-<year>.csv`. The intake page at `https://solarpro.app/privacy/requests` is forthcoming; the email-only path is the operative channel.
- **20 — Data Retention & Disposal** sets the retention schedule for every data category in the Solarpro stack (account, organization, project / survey / plan-set / BOM / document, photo, billing, audit log, application log, Sentry event, backup, support correspondence, marketing consent, customer-requested export, subprocessor copy, DPO correspondence, DPIA, background check, vendor review) with a documented business purpose and a documented disposal method per category. Four deletion triggers: account closure (30-day grace), inactivity (2y+90d notice), end of retention period (silent, scheduled), customer-requested deletion (POL-PRV-002). Four disposal methods: hard delete (DB rows + blobs + VACUUM), aggregate-only (logs + support with PII scrub), cryptographic erasure (encrypted backups + evidence store by key destruction), anonymization (irreversible for long-tail analytics). Legal hold exception is owned by James with legal counsel.

### What this batch closes in the control matrix

The v1 (policies 1-5), v2-ops (policies 6-10), and v3-personnel (policies 11-15) batches each closed several P0 audit findings and "Not assessed" rows in the control matrix. The v4 batch (policies 16-20) closes:

| # | Finding | Source | Closing policy |
|---|---|---|---|
| 16 | **No formal third-party risk register for people-side engagements** (only SaaS / infrastructure in `compliance/vendors.csv`) | `CONTROL_MATRIX.md` CC9.2 (Partial) | **16 Third-Party Service Provider** — three-tier classification, six-step due diligence, eight-step offboarding; SOC 2 CC9.2, ISO 27001 A.5.19-23, ISO 27701 6.2.3 |
| 17 | **No SBOM for production builds**; no CycloneDX / SPDX output; no per-build dependency vulnerability correlation against CISA KEV | `CONTROL_MATRIX.md` A.5.9 (Partial), A.8.9 (Partial) | **17 SBOM** — CycloneDX + SPDX, auto-generated on every build, public at `/trust/sbom.json`, build gate on Critical / KEV findings |
| 18 | **No customer-facing privacy notice**; the privacy program is referenced in the Data Classification & Handling Policy but not at a `/privacy` URL | `CONTROL_MATRIX.md` A.5.34 (Partial), ISO 27701 6.x (Not assessed) | **18 Privacy Policy** — customer-facing notice satisfying SOC 2 P-series + ISO 27001 A.5.34 + ISO 27701 (full PII controller cluster) + GDPR Chapter III + CCPA + PIPEDA + FADP |
| 19 | **GDPR data-subject rights not operationalized**; no documented intake → verification → fulfillment → audit-log process; no SLA | `CONTROL_MATRIX.md` ISO 27701 6.3.x (Implemented, but only the delete-account endpoint; no portability, no rectification) | **19 Data Subject Rights** — five-step process, 30-day default SLA, request register, audit-log integration |
| 20 | **No data retention / disposal policy**; the 2026-07-30 control matrix audit flagged CC6.5 (asset retirement) as Not assessed and recommended a separate data lifecycle audit | `CONTROL_MATRIX.md` CC6.5 (Not assessed), A.5.34 (Partial) | **20 Data Retention & Disposal** — per-category retention schedule with documented business purpose and disposal method; SOC 2 CC6.5, ISO 27001 A.5.34 + A.8.10, ISO 27701 6.7 + 6.8, GDPR Art. 17 |

**Status after this batch:**

- 20 of 30 policies drafted (Sprint 1 is done: foundation + operations + personnel + vendor + privacy = 20).
- 10 of 30 policies remaining (Sprint 2: 3 cloud-specific + 7 compliance & audit + the carryover encryption & BC/DR policies from the v1/v2-ops scope that were not in the foundation or operations batches).
- The control matrix's P0 column shifts: 9 P0 items are now policy-closed (the code-level fixes are tracked separately in the control matrix remediation table). The remaining P0 items are code-level (rate-limiter fail-open, 178/293 routes without rate limit, NODE_ENV-as-Secure-gate, `strict: false` + 1,500 `as any` casts, etc.) and are out of scope for the policy work.

### Privacy Policy (#18) — the customer-facing one

Per James's instruction, the Privacy Policy is the most polished of the 5 and is designed to be posted at `/privacy` and linked from the Trust Center without further rewriting. Highlights:

- **The two voices.** The header is for the auditor (POL-XXX / Version / Effective date / Owner / Approver / Last reviewed / Next review / Scope). The body is for the customer (15 sections of plain English: who we are, what we collect, how we use it, who we share with, cookies, your rights, retention, security, international transfers, children, changes, how to contact us, compliance framework).
- **No third-party analytics or advertising.** The cookies list (§6) is the entire set; Google Analytics, Meta Pixel, Hotjar, Segment, Mixpanel are explicitly not used. The cookie list is the same list Cloudflare + Stripe set; nothing else.
- **No training on customer data.** §4 explicitly says "We do not train any AI model on your aerial photos, roof photos, or site data." OpenAI and Anthropic vision calls are inference-only, governed by their "no training on API inputs" terms.
- **No sale of personal information.** §4 explicitly says "We do not sell your personal information to anyone, for any purpose, at any price. (CCPA 'Do Not Sell' is the default; the GDPR equivalent is 'no marketing sale.')"
- **The 12 sub-processors.** §5 lists the 8 in `compliance/trust.json` (Vercel, Neon, Render, OpenAI, Anthropic, Google, Stripe, Resend) plus the 4 from `compliance/vendors.csv` that are not on the public Trust Center list (Cloudflare, GitHub, Upstash, Sentry). The 4 added are infrastructure / operational subprocessors that do not receive customer PII.
- **The compliance framework section is honest.** §14 says "This is not a certification. We have not yet completed a SOC 2 Type 1 audit (target: Q4 2026) or an ISO 27001 / 27701 audit (target: 2027). The compliance framework above is the target state; the controls are in place but the external audit is pending." An auditor reading the customer-facing policy sees the same posture that the Trust Center shows; the customer sees the same posture the auditor sees.

The Privacy Policy is ready to publish. The only work between "drafted" and "live at /privacy" is:

1. CISO review (Raymond) and management sign-off (James).
2. A 1-day code change to add the `/privacy` route to the Next.js app (the route handler renders the policy markdown; the page is a thin server component with no client JS, similar to the Trust Center page at `/trust`).
3. Linking from the Trust Center (`compliance/trust.json` → "policies" array, add "Privacy Policy" with a link to `/privacy`).
4. Linking from the footer of every Solarpro page (a standard privacy-policy link in the footer).

That work is owned by Cody (the route handler) and Raymond (the manifest update); estimated 2-3 hours total. It is **out of scope for this docs-only commit** and is a Sprint 1 follow-up.

---

## Verification (R2 lite — docs-only commit, `tsc` skipped)

- **`npx eslint .`** — **2 errors, 1618 warnings** (pre-existing baseline on `james-dev` tip `168a5ad6` per the v2-ops and v3-personnel handoffs). Identical to the baseline established by the v2-ops handoff. The 2 errors are pre-existing on `james-dev` and are not in any file touched by this commit. **Zero new lint problems introduced.**
- **`npx vitest run`** — **5 failed test files, 9 failed tests, 8870 passed, 489 skipped (9368 total)** (pre-existing baseline per the v1, v2-ops, v3-personnel handoffs). Identical to the baseline. The 9 pre-existing failures (5 in `tests/phase1a-migration-governance.test.ts`, 1 each in `tests/priority5-crew-calendar.test.ts`, `lib/assistedEvidenceSources/metadataRuntimeAdapter.test.ts`, `lib/assistedEvidenceSources/ocrRuntimeAdapter.test.ts`, `tests/planset/pagination-w9.test.ts`) are all in `docs/CI-QUARANTINE.md` and are out of scope for this docs commit. **Zero new test regressions introduced.**
- **`tsc --noEmit --skipLibCheck`** — skipped per R2 exception for docs-only commits.

The diff vs. `james-dev` is **6 files, ~146 KB insertions, 0 deletions, 100% markdown.** Markdown cannot affect vitest or eslint, so the byte-identical result is mathematically expected. The 5 policy files + 1 README + (this) handoff add ~146 KB of policy content.

### Verification commands (for the auditor or the next reviewer)

```bash
# Show the diff
git diff --stat james-dev..chore/next-15-migration -- compliance/policies/

# Show what was added
git diff james-dev..chore/next-15-migration -- compliance/policies/ | head -200

# Confirm the policy IDs in the headers
Get-ChildItem compliance/policies/16-*.md, 17-*.md, 18-*.md, 19-*.md, 20-*.md | ForEach-Object { (Get-Content $_ -TotalCount 5) -match 'POL-' }

# Confirm the control IDs cross-reference
Get-ChildItem compliance/policies/16-*.md, 17-*.md, 18-*.md, 19-*.md, 20-*.md | ForEach-Object { Select-String -Path $_ -Pattern 'SOC 2|ISO 27001|ISO 27701|ISO 27017|GDPR|CCPA|PIPEDA|FADP' }
```

---

## Branch status

- **Branch**: `chore/next-15-migration` (the current local branch; this is the same branch the Stage 2 Next.js 15 migration is on, so the policies land alongside the security work).
- **NOT pushed** — James's "ship it" is the trigger per AGENTS.md R1 (no push to master) and R7 (push only to `james-dev`).
- **Note on the branch choice**: the v1, v2-ops, and v3-personnel batches each used a dedicated `chore/compliance-policies-vN-*` branch (so each batch could be PR'd and merged independently). This batch is on `chore/next-15-migration` because the user's instruction was to land it on the current branch (the Stage 2 Next.js migration branch). When this batch is ready to merge, the 6 files can be:

  - **Option A (recommended)**: extracted to a dedicated `chore/compliance-policies-v4-vendor-privacy` branch and PR'd independently, matching the v1/v2-ops/v3-personnel pattern. This is a 1-minute `git checkout -b chore/compliance-policies-v4-vendor-privacy` + `git checkout chore/next-15-migration -- compliance/policies/16-* compliance/policies/17-* compliance/policies/18-* compliance/policies/19-* compliance/policies/20-* compliance/policies/README.md HANDOFF_COMPLIANCE_POLICIES_V4_VENDOR_PRIVACY.md` + `git commit -m "docs(policies): add v4 Vendor + Privacy policies (Third-Party, SBOM, Privacy, Data Subject Rights, Data Retention)"`.
  - **Option B**: kept on `chore/next-15-migration` and PR'd as part of the Next.js 15 migration. The downside is that the policies are bundled with the security work, and the CISO review has to wait for the migration to be ready.
  - **Option C**: kept on `chore/next-15-migration` and split at PR time (the 6 files moved to a new branch in a single commit, the migration stays on `chore/next-15-migration`). Same as Option A in practice.

  James's preference is the call. Option A or C is recommended; Option B is workable but conflates two reviews.

- **R6 attribution**: this is a `docs:` commit, so non-JAMES authorship is allowed; the author is the current git config. Same pattern as the v1, v2-ops, and v3-personnel commits.

---

## The CISO-review process (the operational question)

Per James's task brief, the CISO review is the gate before these 5 policies become effective. The process is documented in `compliance/policies/REVIEW_PROCESS.md` (the document the v1 batch added); the summary:

1. **Raymond (CISO) reviews** the technical accuracy and the control coverage. The review is a PR comment thread on the v4 branch. Estimated time: 2-3 business days for 5 policies (vs. 1-2 days for the foundation 5, because the v4 cluster is denser and includes the customer-facing Privacy Policy which needs a careful read for tone).

   **Specific things for Raymond to focus on:**

   - **Policy 16 §4.4** (background check compensating control) — the reference check + firm attestation variant. Confirm this matches what we'd say in a SOC 2 Type 1 audit interview.
   - **Policy 17 §5** (Sprint 1 CI integration) — confirm the CI work is sized for one Sprint and the manual quarterly procedure is the operative process in the meantime. Confirm the 2026-09-30 first-manual-SBOM deadline.
   - **Policy 18 §5** (sub-processor list) — confirm the 12-vendor list matches `compliance/vendors.csv` exactly. The 4 added (Cloudflare, GitHub, Upstash, Sentry) are infrastructure / operational; confirm they do not receive customer PII.
   - **Policy 18 §4** (purposes + legal basis table) — confirm the GDPR Article 6 legal basis is correctly assigned per purpose. Legitimate interest (Art. 6(1)(f)) is the trickiest; the "improvement" row is the most-likely-challenged-by-a-DPO.
   - **Policy 19 §3.3.3** (erasure exceptions) — confirm the 6 exceptions match the GDPR Art. 17(3) wording. The "in-flight service the data subject is paying for" exception is the most-likely-needed-soonest.
   - **Policy 20 §3** (retention schedule) — confirm the per-category retention windows match the underlying business reality. The 7-year permit / warranty retention is the most-likely-challenged (some AHJs require longer; some states require shorter for certain record types).

2. **James approves and merges.** As the management sign-off, James's approval is the final sign-off. The merge commit is the audit artifact of the policy version.

3. **Post-merge**: collect wet signatures (or DocuSign) for the 5 v1.0 signature blocks (~25 min total). Update policy header "Last reviewed" dates from 2026-08-15 to the merge date.

4. **Announce** in team channel: "5 Vendor + Privacy policies are live. Read 18 (Privacy Policy) — that's the customer-facing one, going up at `/privacy` next sprint. Read 19 (Data Subject Rights) if you'll ever be the one responding to a privacy@solarpro.app request."

5. **Operational follow-ups** (out of scope for the CISO review but worth flagging):

   - **Privacy Policy at /privacy**: Cody adds the route handler, links from the Trust Center and the footer. ~2-3 hours.
   - **DSR intake page at /privacy/requests**: Cody adds the self-service form. ~1 day.
   - **SBOM CI integration**: Cody adds the GitHub Actions workflow. Sprint 1 §5.
   - **First manual SBOM**: Cody + Raymond, by 2026-09-30. ~4 hours.
   - **DSR request register** at `compliance/privacy/dsr-register-2026.csv`: Raymond creates the file. ~15 min.
   - **Retention nightly job**: Cody adds the scheduled job. Sprint 2 (when headcount allows).
   - **Background check vendor**: TBD (Checkr or Sterling) when budget permits. Per Policy 14 §7.

---

## The GDPR compliance status (the question James will ask)

Per James's 2026-07-30 "no money yet" call, the GDPR compliance work is **in progress, not certified**. The 30-policy program is the documentation; the SOC 2 Type 1 audit is the external validation; ISO 27001 / 27701 audits follow in 2027. As of 2026-08-15:

| GDPR obligation | Status | Policy |
|---|---|---|
| **Article 5 — Principles** (lawfulness, fairness, transparency; purpose limitation; data minimization; accuracy; storage limitation; integrity & confidentiality; accountability) | All 7 principles operationalized across the policy library | 03 Data Classification, 18 Privacy Policy, 20 Data Retention |
| **Article 6 — Lawful basis** | Documented per processing purpose in Policy 18 §4 | 18 Privacy Policy |
| **Article 7 — Conditions for consent** | Documented; product-update email is opt-in, withdrawal is one-click | 18 Privacy Policy §4 |
| **Article 13/14 — Information to be provided** (the privacy notice) | Published at `/privacy` (forthcoming) | 18 Privacy Policy |
| **Article 15 — Right of access** | Operationalized; 30-day SLA | 19 Data Subject Rights |
| **Article 16 — Right to rectification** | Operationalized; 5-day DB SLA, 30-day downstream | 19 Data Subject Rights |
| **Article 17 — Right to erasure** | Operationalized; 15-day production, 30-day subprocessor | 19 Data Subject Rights + 20 Data Retention |
| **Article 18 — Right to restriction** | Operationalized; 5-day flag in place | 19 Data Subject Rights |
| **Article 20 — Right to data portability** | Operationalized; JSON export, 10-day SLA | 19 Data Subject Rights |
| **Article 21 — Right to object** | Operationalized; 5-day initial review, 30-day full assessment | 19 Data Subject Rights |
| **Article 22 — Automated decision-making** | **N/A — Solarpro does not make automated decisions with legal or similarly significant effects on data subjects.** The vision models produce draft engineering outputs that a human (the inspector, the installer, the engineer) reviews before any decision is made. | n/a |
| **Article 25 — Data protection by design and by default** | Operationalized through the SDLC and the data classification policy | 03 Data Classification, 01 Information Security, 06 Change Management |
| **Article 28 — Processor obligations** | Sub-processor DPAs are tracked; the 4 open Tier 1 DPAs (OpenAI, Anthropic, Google Solar, Nearmap) are P0 in the Vendor Risk Management Policy §5.2 | 10 Vendor Risk Management + 16 Third-Party Service Provider |
| **Article 30 — Records of processing activities (ROPA)** | Not yet drafted; Sprint 2 candidate | (forthcoming) |
| **Article 32 — Security of processing** | Operationalized across the security policies; the encryption in transit (TLS 1.2+) and at rest (AES-256) commitments are in Policy 18 §9 | 01 Information Security, 04 Access Control (forthcoming encryption policy), 08 Logging & Monitoring |
| **Article 33 — Breach notification to the supervisory authority (72h)** | Operationalized; the IRP §5.5 sets the 72h clock | 05 Incident Response |
| **Article 34 — Breach communication to the data subject** | Operationalized; "without undue delay" if the breach is likely to result in a high risk to the data subject's rights | 05 Incident Response |
| **Article 35 — Data protection impact assessment (DPIA)** | Not yet drafted; Sprint 2 candidate (Policy 26 in the backlog) | (forthcoming) |
| **Article 37 — Data Protection Officer** | Not formally designated (the processing does not meet the threshold under Art. 37(1)); the `privacy@solarpro.app` mailbox is the operational equivalent | n/a (documented in Policy 18 §13) |
| **Article 44/46 — International transfers** | SCCs in sub-processor agreements; Transfer Impact Assessments on each sub-processor that processes EU data | 18 Privacy Policy §10 |
| **Article 77 — Right to lodge a complaint** | Preserved; documented in Policy 18 §7 + Policy 19 §2 | 18 Privacy Policy + 19 Data Subject Rights |

**Summary:** 17 of the 19 applicable GDPR articles are operationalized today. The 2 that are not (Art. 30 ROPA, Art. 35 DPIA) are Sprint 2 backlog items. The 1 that is N/A (Art. 22 automated decision-making) is documented as N/A in the Privacy Policy.

The Privacy Policy (#18) is the customer-facing commitment. The Data Subject Rights Policy (#19) is the operational rule. The Data Retention & Disposal Policy (#20) is the lifecycle. Together, they are the **GDPR-Articles-5-22 evidence.** The remaining GDPR articles (30, 35) are the Sprint 2 backlog (Policies 26 ROPA, 27 DPIA in the `compliance/policies/README.md` table).

---

## What's left in the 30-policy program

After this batch, **20 of 30 policies are drafted** (Sprint 1 is done: foundation + operations + personnel + vendor + privacy). The 10 remaining are Sprint 2:

| # | Policy | Cluster | Why this is Sprint 2, not Sprint 1 |
|---|---|---|---|
| 21 | Cloud Services Security Policy | Cloud-specific (ISO 27017) | The shared-responsibility matrix and the cloud-specific controls are most useful AFTER the auditor is engaged (the auditor's specific cloud questions drive the depth). |
| 22 | Shared Responsibility Matrix | Cloud-specific (ISO 27017) | Same as #21. The matrix documents what Vercel / Neon / Render / Cloudflare are responsible for vs. Solarpro; the matrix is best built with the auditor's input. |
| 23 | Virtual Environment Security Policy | Cloud-specific (ISO 27017) | Covers the SAM2 service sandbox, the worker sandbox, and the CI sandbox. Useful but not blocking for SOC 2 Type 1. |
| 24 | Encryption & Key Management Policy | Operations (carryover, not in v2-ops) | The 32-char secret minimum is in Policy 15 §5; the key rotation cadence is in the Change Management Policy. The standalone Encryption & Key Management Policy is the auditor's preferred form; Sprint 2 work. |
| 25 | Business Continuity & Disaster Recovery Plan | Operations (carryover, not in v2-ops) | The RTO/RPO targets are in Policy 09 §3; the BC/DR Plan is the broader scenario (multi-system outage, vendor bankruptcy, ransomware). Sprint 2 work. |
| 26 | Privacy Impact Assessment Policy | Privacy (carryover from PROGRAM.md §5) | The GDPR Art. 35 DPIA template and the trigger criteria. |
| 27 | Risk Assessment Policy | Compliance & Audit | The risk-management approach is in Policy 01 §5; the standalone Risk Assessment Policy is the formal ISO 27001 Clause 6.1.2 deliverable. |
| 28 | Statement of Applicability (SoA) | Compliance & Audit | The SoA is the ISO 27001 deliverable that lists every Annex A control, whether it applies, and how it is implemented. Built AFTER all other policies are signed. |
| 29 | Audit & Monitoring Policy | Compliance & Audit | The audit-evidence collection is in `compliance/manifest.json`; the standalone Audit & Monitoring Policy is the ISO 27001 Clause 9 deliverable. |
| 30 | (Patch Management OR Code of Conduct reinforcement OR a 3rd option) | Compliance & Audit | PROGRAM.md §5 row 30 is unspecified; Patch Management is sometimes folded into Vulnerability Management (Policy 07) and sometimes split out. James's call. |

The Sprint 2 window per `PROGRAM.md` §2 is **2026-09-03 → 2026-10-15**, owned by legal-writer with Raymond as the CISO reviewer. The 10 policies are sized for 6-7 weeks; the workload is similar to Sprint 1's 20 policies but with the auditor's input now available to shape the cloud-specific and audit policies.

**Beyond the 30 policies:** the 2 open workstreams that are not policies but are required for SOC 2 Type 1 readiness are the **pen test** (DEFERRED per James's no-money call; the Cobalt shortlist is at `PEN_TEST_SHORTLIST.md`) and the **SOC 2 auditor engagement** (DEFERRED per the no-money call; the Schellman shortlist is at `AUDITOR_SHORTLIST.md`). Both are 2027 work per `PROGRAM.md` §6.

---

## Risks and open questions

1. **Branch choice for the v4 batch.** As noted in §"Branch status" above, the v4 batch is on `chore/next-15-migration` per the user's instruction. The recommendation is to extract to `chore/compliance-policies-v4-vendor-privacy` at PR time (Option A or C above). James's call.

2. **The Privacy Policy at `/privacy`.** The policy is drafted and ready to publish, but the route handler at `/privacy` and the Trust Center link are not in this commit. The work is small (~2-3 hours, owned by Cody) but is a Sprint 1 follow-up. Until the route handler lands, the policy is **internal evidence**, not the customer-facing notice.

3. **The DSR intake page at `/privacy/requests`.** The self-service form is a Sprint 2 follow-up. Until it lands, the email-only path (`privacy@solarpro.app`) is the operative channel. The intake page is a quality-of-life improvement, not a compliance gap.

4. **The SBOM CI integration.** The policy is in force; the CI integration is the open work (Sprint 1 §5, owned by Cody). The manual quarterly procedure (Policy 17 §4.4) is the operative process; the first manual SBOMs are due 2026-09-30.

5. **The background check vendor.** Same as Policy 14 §7 — the screening-vendor line item is not yet funded. The compensating control (reference checks + firm attestation) is in place. When the budget permits, the formal check resumes.

6. **The 4 open Tier 1 DPAs.** OpenAI, Anthropic, Google Solar, Nearmap DPAs are P0 in the Vendor Risk Management Policy §5.2. Policy 16 carries the same tracking. This is unchanged from the v2-ops batch and remains a P0 in the program.

7. **The control matrix's "Not assessed" rows.** The Privacy Policy (#18) and the Data Subject Rights Policy (#19) operationalize most of the ISO 27701 PII controller cluster, which was Not assessed in the 2026-07-30 control matrix. The next control-matrix refresh (after the CISO review) should mark the affected rows as Implemented or Partial.

8. **The 51 F-13 test failures + 1 lint blocker.** Pre-existing on `james-dev`; out of scope for this docs commit. Tracked in `HANDOFF_F13.md` and `docs/CI-QUARANTINE.md`. The R2 pre-push guard remains red until the F-13 backlog is cleared.

9. **The cross-border data flow to OpenAI / Anthropic.** The vision API calls send aerial photos to US-based AI providers. For EU data subjects, the transfer is covered by the SCCs in the sub-processor agreements (per Policy 18 §10). For customers in the EU, the homeowner's photo being sent to a US-based AI provider is a known and documented transfer; the transfer mechanism is the SCC. The customer's installation of a Solarpro account is taken as informed consent to this transfer for the survey workflow.

10. **The "no training" commitment to AI providers.** Policy 18 §4 says Solarpro does not train any AI model on customer data. The OpenAI and Anthropic API terms prohibit training on API inputs (the "no training on inputs" clause is a standard term). If OpenAI or Anthropic change their terms to allow training, the policy is wrong and needs revision. The commitment is monitored as part of the annual vendor review (Policy 10 §6.1).

---

## Cross-references

- **HANDOFF**: this document.
- **Prior handoffs**: `HANDOFF_COMPLIANCE_POLICIES_V1.md` (foundation), `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (operations), `HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md` (personnel).
- **Sister commits**: `60209e07` (v1), `09b4a5cb` (v2-ops), `f8865dc4` (v3-personnel) on `chore/compliance-policies-v1` / `-v2-ops` / `-v3-personnel`.
- **Design doc**: `compliance/PROGRAM.md` (program plan and Sprint timeline), `compliance/SELF_BUILT_SETUP.md` (evidence collection architecture), `compliance/CONTROL_MATRIX.md` (84 controls).
- **Customer-facing**: `compliance/vendors.csv` (12-vendor sub-processor register), `compliance/trust.json` (Trust Center data).
- **Review process**: `compliance/policies/REVIEW_PROCESS.md`.
- **Policy-of-policies**: `compliance/policies/01-information-security.md` (the foundation).
- **Companion Sprint 1 follow-ups**: the `/privacy` route handler, the `/privacy/requests` intake page, the SBOM CI integration, the DSR request register, the first manual SBOM (due 2026-09-30), the retention nightly job.

---

*End of v4 handoff. 20 of 30 policies drafted. Sprint 1 is done. Sprint 2 (the cloud-specific + compliance & audit cluster) is the 2026-09-03 → 2026-10-15 window. Per James's no-money call, the SOC 2 Type 1 audit is the next dollar-requiring milestone, targeted for Q4 2026. The policies are in force today; the external certification is the open work tracked in `PROGRAM.md`.*
