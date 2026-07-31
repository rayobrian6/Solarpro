# HANDOFF — Compliance Policies v2 (Sprint 1 Operations cluster)

**Status:** Drafted, **NOT PUSHED**, awaiting review and signature.
**Author:** Mavis / compliance-lead via legal-writer
**Date:** 2026-08-15
**Per:** F-13 handoff convention (see prior `HANDOFF_*.md` files at repo root).
**Companion to:** `HANDOFF_COMPLIANCE_POLICIES_V1.md` (Sprint 1 foundation, 2026-08-15).

---

## What was done

Drafted the **5 Operations-cluster policies** for Solarpro's SOC 2 Type 1 / ISO 27001 / 27701 / 27017 program, in `compliance/policies/`. These join the 5 foundation policies drafted in `HANDOFF_COMPLIANCE_POLICIES_V1.md`. Total: **10 of 30 policies drafted**, foundation + operations complete.

| # | File | Title | Size | Status |
|---|---|---|---|---|
| 06 | `compliance/policies/06-change-management.md` | Change Management Policy | 18 KB | Drafted, awaiting signature |
| 07 | `compliance/policies/07-vulnerability-management.md` | Vulnerability Management Policy | 17 KB | Drafted, awaiting signature |
| 08 | `compliance/policies/08-logging-monitoring.md` | Logging & Monitoring Policy | 22 KB | Drafted, awaiting signature |
| 09 | `compliance/policies/09-backup-recovery.md` | Backup & Recovery Policy | 16 KB | Drafted, awaiting signature |
| 10 | `compliance/policies/10-vendor-risk-management.md` | Vendor Risk Management Policy | 19 KB | Drafted, awaiting signature |
| — | `compliance/policies/README.md` | Policy library index | updated | Updated to add the new 5 |

**Total**: 5 new policies + 1 updated index, ~92 KB of new policy content. All in plain English per James's preference for non-preachy direct language.

### P0 audit findings closed by this batch

Three of the 2026-07-30 P0 audit findings are now policy-closed (the code-level fixes are tracked separately in the control matrix remediation table):

| # | Finding | Source | Closing policy |
|---|---|---|---|
| 1 | **5 high-severity Next.js 14 DoS CVEs unpatched**; no `npm audit` in CI; no Dependabot; lockfile stale | `SECURITY_ADVISORY_DEPS` §1, `CONTROL_MATRIX.md` P0 #1 | **07 Vulnerability Management** — three-cadence scanning (Dependabot daily / Snyk weekly / manual quarterly), four-tier SLAs (24h / 7d / 30d / next cycle), explicit classification of the five CVEs in §6.1 |
| 6 | **207 empty `} catch {}` swallows** (160 in `SolarEngine3D.tsx`); 2,537 unstructured `console.*` calls; no structured logger | `audit_code_quality` §2 #3, §7.2; `CONTROL_MATRIX.md` P0 #6 | **08 Logging & Monitoring** — "no silent catch" rule, `safeViewerOp()` helper pattern, 12-field structured log schema, exception process for the 207 legacy catches (50 per Sprint wave plan) |
| 10 | **OpenAI/Claude fail-silent** + no budget cap + **no DPAs** for OpenAI, Anthropic, Google Solar, Nearmap | `audit_solar_ml` §2 #4, #5; `audit_consolidated` §7; `CONTROL_MATRIX.md` P0 #10 | **10 Vendor Risk Management** — three-tier classification, Tier 1 DPA-pending tracker at `compliance/monitoring/vendor-dpa-pending.md`, SOC 2 Type 2 collection cadence |

The fourth Operations-cluster policy (06 Change Management) reinforces the four-gate migration governance that is already exemplary; the fifth (09 Backup & Recovery) formalizes the 4h/1h RTO/RPO targets and the weekly/quarterly verification cadence.

### Design choices (continuing from v1)

1. **Same header table format** as the foundation five. Policy / Version / Effective date / Owner (CISO) / Approver (Management) / Last reviewed / Next review / Scope — all in the same shape, so the policy library reads as one document.
2. **Concrete, not template.** Raymond, James, Cody. Real systems: Vercel, Neon, Render, OpenAI, Anthropic, Google Solar, Stripe, Cloudflare, GitHub, Sentry, R2. The `2026-08-12 rate-limiter fail-open` incident is referenced where it changes the rule.
3. **The P0 finding being closed is named in the policy.** §6 of the Vulnerability Management policy classifies the five Next 14 CVEs under this policy's framework. §5.2 of the Logging & Monitoring policy defines the "no silent catch" rule that closes the 207 swallows. §5.2 of the Vendor Risk Management policy tracks the four open Tier 1 DPAs as named P0 items.
4. **Operational realism.** The 4-hour database RTO assumes a fresh Neon project + PITR restore; the 30-minute rollback rule in the Change Management policy is a real lever, not aspirational; the 50-per-Sprint silent-catch wave plan matches the actual capacity of the next two sprints.
5. **Cross-references to the control matrix are explicit.** Every policy's "Related documents" section names the specific control IDs the policy satisfies. The full mapping remains in `compliance/CONTROL_MATRIX.md`.
6. **The exception process is consistent across all 10.** Linear issue tagged `compliance-exception` → Raymond approval → 90-day max → James disclosure for P0. The Information Security Policy §8 is the root.

### Policy-specific design notes

- **06 Change Management** extends the four-gate migration governance (`advisory lock → checksum → ledger → allowlist`) to every other kind of change. The "no silent approvals" rule in §4.1 makes Slack-based "ship it" non-binding; verbal emergency approval is temporary and replaced by a PR review within 24 hours.
- **07 Vulnerability Management** is intentionally the most concrete of the five. It names Dependabot (daily), Snyk (weekly), the manual quarterly review cadence, the four-tier SLAs, and the worked examples in §6 are the actual CVEs in the policy-closing finding. The "active exploitation override" in §4.1 is a check against CVSS-anchor bias.
- **08 Logging & Monitoring** is the policy that closes the 207-finding. The "no silent catch" rule is the rule. The redaction list in §7.1 is exhaustive enough to be the audit evidence; the `redacted_fields` column on the `audit_log` table is the runtime enforcement. The `safeViewerOp()` helper is the tactical pattern for the 160 SolarEngine3D swallows.
- **09 Backup & Recovery** makes the implicit explicit. The RTO/RPO table in §3 is commitments, not aspirations; missing a target is a Sev2. The three-cadence verification (weekly existence, quarterly full restore, annual DR exercise) is what the auditor needs to see.
- **10 Vendor Risk Management** references `compliance/vendors.csv` (being built in parallel) and the upcoming `compliance/monitoring/vendor-dpa-pending.md` tracker. The current vendor list in §5 names the 14 vendors in the operating stack and tracks the four open Tier 1 DPAs as named P0 items. The offboarding checklist in §7 is the rule that prevents the credential-leak incident pattern from recurring on a vendor exit.

## What needs to happen next

### Who reviews

- **Raymond O'Brien (CISO)** reviews the technical accuracy of all 5 policies. Estimated time: 60-90 minutes total (the Vulnerability Management and Logging & Monitoring policies are the longest; the Backup & Recovery policy is the most table-heavy).
- **James Carpenter (CEO)** reviews for management sign-off and merges. Estimated time: 20-30 minutes for a skim if Raymond's review is clean. The Vendor Risk Management policy §5 is the one James reads most carefully — the Tier 1 vendor list is the commercial reality.

### What James needs to do

1. **Open a PR** titled `policy: operations cluster (06-10)` (or similar) that includes all 6 new files (5 policies + 1 README update). Suggested base branch: `master`. Suggested reviewer: `raymond` (GitHub handle).
2. **Tag Raymond** for review. He has 2-3 business days for this batch (the operations cluster is denser than the foundation).
3. **After Raymond's LGTM**, James merges. The merge commit is the audit artifact.
4. **Collect wet signatures** (or DocuSign equivalent) for the v1.0 signature blocks. Same process as the foundation. Estimated time: 5 minutes per policy × 5 policies = 25 minutes.
5. **Update the policy headers** post-merge: change "Last reviewed" from 2026-08-15 to the merge date, leave "Next review" as 2027-08-15.
6. **Announce in Slack** (#announcements or team channel): "5 operations policies are live. Read 06 (Change Management) and your role-specific one (Cody: 06 + 07 + 08; James: 10; Raymond: all 5)."

### What Raymond needs to do

1. **Review each policy** for technical accuracy. The big things to check:
   - **06 Change Management**: the approval matrix in §4 matches how the team actually operates. The four-gate review in §5 is the same standard the four-gate migration governance already uses. The 30-minute rollback rule in §7.1 is operationally realistic. The standard/normal/emergency classification captures the actual change mix.
   - **07 Vulnerability Management**: the severity classification in §3 matches his mental model. The remediation SLAs in §4 are operationally realistic — 24h for Critical is tight; 7d for High is the standard. The worked examples in §6 correctly classify the five Next 14 CVEs as Critical/High. The exception process in §7 is enforceable.
   - **08 Logging & Monitoring**: the 12-field schema in §3 captures every event the team needs to investigate. The redaction list in §7.1 is exhaustive — confirm nothing was missed. The `safeViewerOp()` pattern in §5.2 is the right shape for the 160 SolarEngine3D swallows. The 50-per-Sprint wave plan in §5.4 is realistic capacity. The alert thresholds in §9 are sensible defaults.
   - **09 Backup & Recovery**: the 4h/1h RTO/RPO targets in §3 match the actual Neon PITR + Vercel rollback capabilities. The three-cadence verification is sustainable. The four runbooks in §6 are accurate.
   - **10 Vendor Risk Management**: the Tier 1 vendor list in §5.1 is complete. The four open DPAs in §5.2 are the actual gaps. The offboarding checklist in §7 is enforceable.
2. **Leave a comment in the PR** with any changes. If no changes, "LGTM."

### What Cody needs to do

Review the technical implementation aspects of:

- **06 Change Management §6** (env vars, secrets, rate limits) — confirm the cadence matches what he actually does.
- **08 Logging & Monitoring §4.1** (the `audit_log` table schema) — confirm the schema is implementable; flag any columns that would be expensive to populate.
- **09 Backup & Recovery §5.2** (the quarterly restore test procedure) — confirm the procedure is realistic for a Tuesday-morning 4-hour block.

Cody is in the review loop for these three. The other two (07, 10) are not blocking on his review.

## What's left in the 30-policy program (20 more)

10 of 30 policies are drafted (5 foundation + 5 operations). The remaining 20 are scoped for Sprint 2 (2026-09-03 → 2026-10-15) per `compliance/PROGRAM.md` §5. The list, grouped by area, is below. The list is identical to the one in `HANDOFF_COMPLIANCE_POLICIES_V1.md` minus the 5 done in this batch.

### Information Security (2 remaining)

- **Password & Authentication Policy** — the Access Control Policy references it but it should stand alone. Sprint 1 time pressure deferred it.
- **Encryption & Key Management Policy** — the secret-rotation cadence (90d / 365d / on-departure) referenced in 06 and 09 needs a home.

### Operations (2 remaining)

- **Business Continuity & Disaster Recovery Plan** — the tabletop and the multi-system outage scenario. Pairs with 09 Backup & Recovery.
- **Patch Management Policy** — OS patching on developer endpoints, base Docker image patching for SAM2. The vendor side is in 07. The endpoint side is in the Acceptable Use Policy today.

### Personnel (4)

- **Code of Conduct** — for the team and for new hires. Required for SOC 2 CC1.1.
- **Employee Onboarding/Offboarding Policy** — the 24h deprovisioning rule is in 03; this expands to the full lifecycle (offer letter, equipment, training, offboarding checklist).
- **Security Awareness & Training Policy** — annual training cadence, phishing simulations.
- **Background Check Policy** — required for new hires and for the contracted incident-response firm.

### Vendor & Third Party (2 remaining)

- **Third-Party Service Provider Policy** — narrower than 10; covers one-off contractors and freelance engagements.
- **Software Bill of Materials (SBOM) Policy** — the SBOM generation cadence, the SBOM distribution policy, the relationship to the dependency tree that 07 manages.

### Privacy / ISO 27701 (4)

- **Privacy Policy (external-facing)** — for the `/privacy` route on the public site.
- **Data Subject Rights Policy** — access, correction, deletion, portability per GDPR Art. 15-20.
- **Data Retention & Disposal Policy** — the 7-year audit retention is in 09 and 04; this expands to the full data lifecycle.
- **Privacy Impact Assessment Policy** — the PIA trigger conditions and the PIA template.

### Cloud / ISO 27017 (3)

- **Cloud Services Security Policy** — the cloud-specific layer; 10 covers vendors generally, this covers the cloud-deployment layer.
- **Shared Responsibility Matrix** — names Vercel, Neon, Render, Cloudflare responsibilities vs. Solarpro's. The auditor will ask for this explicitly under ISO 27017.
- **Virtual Environment Security Policy** — the Vercel preview environment, the staging Neon project, the SAM2 sandbox.

### Compliance & Audit (3)

- **Risk Assessment Policy** — the methodology behind the risk register that 01 §5 references. Lightweight per the 3-person team scale.
- **Statement of Applicability (SoA)** — required for ISO 27001. The manifest at `compliance/manifest.json` is the input; the SoA is the output.
- **Audit & Monitoring Policy** — the SOC 2 / ISO 27001 audit cadence, the internal audit function, the auditor-access flow.

### Total: 20 remaining. Sprint 2 timeline: 2026-09-03 → 2026-10-15. Estimated effort: ~50 person-hours (the 5 operations policies were ~25 hours; the remaining 20 are spread across 4 areas, with the privacy and personnel clusters being the densest). Owner: legal-writer agent, with Raymond as the technical reviewer.

## The CISO review process

The foundation policies in v1 introduced the CISO-as-reviewer pattern. The operations cluster is denser, so the process gets explicit here for the next batches.

### Per-policy review SLA

| Policy type | Review SLA | Sign-off SLA | Total wall time |
|---|---|---|---|
| **Lightweight** (one-paragraph scope, low-control-count) | 1 business day | 0.5 business day | 1.5 business days |
| **Standard** (this operations cluster) | 2-3 business days | 0.5-1 business day | 3-4 business days |
| **Heavyweight** (Privacy, BC/DR, SoA) | 3-5 business days | 1-2 business days | 5-7 business days |

### The review checklist

For every policy, Raymond's review confirms:

1. **Technical accuracy** — does the policy describe how the system actually works?
2. **Control coverage** — does the policy's "Related documents" section name the right control IDs?
3. **Operational realism** — can a 3-person team actually operate against this policy at the cadence it describes?
4. **Audit acceptability** — would an auditor read this and find the evidence they need?
5. **Cross-references** — does the policy reference the foundation policies (01-05) correctly?

Raymond's review comment is one of: `LGTM — no changes needed`, `Changes requested: <list>`, or `Approved with comments: <list>`. The PR is the review record; the comment is the audit artifact.

### The escalation path

A review comment that Raymond and the policy author (the agent team) cannot resolve in 2 review cycles is escalated to James. James's call is final. The escalation is documented in the PR thread.

### The "blocked" path

A policy that cannot be signed off within 4 review cycles (about 2 weeks) is parked and the gap is documented in `compliance/PROGRAM.md` §9. The auditor will see the gap, the rationale, and the remediation timeline. Parking is better than letting an unsigned policy ship and create a control-environment gap.

## Risks and open questions

1. **The Logging & Monitoring Policy §5.4 wave plan** (50 silent catches per Sprint) is sized to the 207-finding over 4 Sprints. If the structured logger (Pino) takes longer than expected to land, the wave plan slips. The plan is documented; the slip is acceptable; the wave can compress to 75 per Sprint if needed.

2. **The Vendor Risk Management Policy §5.2** lists four open Tier 1 DPAs (OpenAI, Anthropic, Google Solar, Nearmap/Eagleview/ATTOM). These are the actual P0 gaps in the control matrix. The policy is the rule; the gap is real. The remediation is tracked in the `vendor-dpa-pending.md` file (forthcoming, parallel to this handoff).

3. **The Change Management Policy §6.2** requires `gitleaks` or equivalent pre-commit secret scanning. The current state is that the GitHub-side secret scanning is enabled (a platform feature), but a developer-side pre-commit hook is not yet in place. The hook is a P1; the absence is a known gap. The policy documents the requirement; the implementation follows.

4. **The Backup & Recovery Policy §3.1** sets a 4-hour RTO for the production database. The first quarterly restore test (Q3 2026) is the empirical measurement. If the test consistently exceeds 4 hours, the policy revises the target with a written rationale. The current target is the best estimate, not a measured number.

5. **The Vulnerability Management Policy §5.2** requires Snyk Open Source as the secondary scanner. Snyk is referenced in the policy but the actual Snyk account is not yet provisioned. Sprint 1 deliverable; not blocking the policy merge.

6. **The Change Management Policy §5.3** requires a Vercel preview deploy for every customer-facing change. Today, every PR against `master` (via the deploy branch) gets a preview. The policy codifies the existing practice; no implementation work needed.

7. **The "Last reviewed 2026-08-15"** date in the policy headers reflects the drafting date. The actual review (and last-reviewed date) is the PR merge date. Same convention as the v1 batch.

## Files written

```
C:\Users\carpe\Solarpro\
├── compliance\
│   └── policies\
│       ├── 06-change-management.md
│       ├── 07-vulnerability-management.md
│       ├── 08-logging-monitoring.md
│       ├── 09-backup-recovery.md
│       ├── 10-vendor-risk-management.md
│       └── README.md            (updated to add the new 5)
└── HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md   (this file)
```

## Cross-references

- `HANDOFF_COMPLIANCE_POLICIES_V1.md` — the foundation batch (2026-08-15).
- `compliance/PROGRAM.md` §5 — full 30-policy scope, 10 done in Sprint 1.
- `compliance/CONTROL_MATRIX.md` — 78 controls, current state, evidence sources, P0 gap remediation table.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture.
- `compliance/SECURITY_ADVISORY_DEPS.md` — the dependency advisory that policy 07 operationalizes.
- `audit_code_quality_2026-07-30.md` §2 #3, §7.2 — the 207-finding that policy 08 closes.
- `audit_security_migrations_2026-07-30.md` — the broader security audit that policy 06, 07, 09 reference.
- `audit_solar_ml_2026-07-30.md` §5 — the open DPAs that policy 10 tracks.

---

**End of handoff. Authored 2026-08-15. Awaiting Raymond's review and James's merge.**
