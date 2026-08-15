# Change Management Policy

| Field | Value |
|---|---|
| **Policy** | POL-OP-003 — Change Management Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All changes to Solarpro production code, infrastructure, configuration, data schema, and third-party vendor relationships. Every environment that serves customer traffic. |

---

## 1. Purpose

This policy is the rule for how changes reach production. It's the **SOC 2 CC8.1 + ISO 27001 A.8.9 / A.8.25 / A.8.28 / A.8.32** evidence: that we authorize, design, test, document, and review changes before they hit customers — and that we have a way to roll them back when they don't.

A 3-person team cannot afford a "we'll fix it in prod" culture. The discipline in this policy is what makes the four-gate migration governance in `lib/migrations/runner.ts` extend from database changes to every other kind of change. The four gates are: **peer review → automated checks → pre-deploy evidence → post-deploy verification**. Every change goes through the same four gates; the difference is the approval depth, not whether gates are applied.

## 2. Scope

This policy applies to every change to:

- **Production code** — the Next.js app on Vercel, the Python SAM2 service on Render, any worker or scheduled job.
- **Infrastructure** — Vercel project configuration, Render service configuration, Neon Postgres settings, Cloudflare DNS / R2 / WAF rules, GitHub repository settings, Google Workspace admin settings.
- **Configuration** — environment variables, feature flags, secrets, rate-limit thresholds, cron schedules, CORS / CSP / cookie settings.
- **Data schema** — every database migration, every change to the canonical models (`CanonicalBuildingModel`, `UnifiedGeometryAuthority`, `lib/permit/snapshot/`), every change to the survey PII schema.
- **Third-party vendors and sub-processors** — adding a new vendor, replacing an existing vendor, changing the data that flows to a vendor, or signing a new DPA.

Out of scope: routine read-only data analysis, internal documentation changes (those follow the `REVIEW_PROCESS.md` standard), and changes to non-production environments that do not touch production data. Those are governed by the Acceptable Use Policy and the Data Classification & Handling Policy.

## 3. Change types

Every change is one of three types. The type drives the approval depth, not whether the change needs approval. **All changes need approval.**

| Type | Definition | Approval | Examples |
|---|---|---|---|
| **Standard** | Pre-approved low-risk change with a documented runbook. Reversible in <15 minutes. No customer-visible behavior change. | Self-approval by the operator, recorded in the PR. No second reviewer required. | Dependency patch via Dependabot auto-merge. Adding a test. Documentation fix. Removing a dead code path behind a feature flag. Rotating a non-production secret. |
| **Normal** | The default. Anything that does not meet the Standard or Emergency bar. | Pull request with at least one peer review. For customer-facing changes, Raymond signs off. | New feature. New API route. New vendor. New data schema. New environment variable. Rate limit change. Auth flow change. |
| **Emergency** | An active Sev1 incident, a confirmed security control failure, or a regulatory deadline. Time-critical. | Verbal approval by James or Raymond. PR opens within 24 hours of deploy. **Post-hoc review is mandatory.** | Hotfix to a production outage. Emergency secret rotation. Rolling back a bad deploy. Patching a CVE that is being actively exploited. |

When in doubt, classify up. A change that "feels like" Standard but touches authentication, billing, or PII is Normal, not Standard.

## 4. Approval matrix

Authority to approve a change is tied to what the change affects, not to seniority. The matrix below is the **SOC 2 CC1.3 evidence**: explicit authority for information security decisions.

| Area of change | Primary approver | Backup approver | Notes |
|---|---|---|---|
| **Application code (customer-facing)** | **Raymond O'Brien** (CISO) | Cody if Raymond is unreachable, with PR comment noting the unavailability | Raymond is the security gate. No customer-facing change ships without his sign-off or an explicit, time-bounded delegation. |
| **Application code (internal-only)** | **Cody** (technical lead) | Raymond for security-sensitive paths | Internal tooling, admin scripts, dev-only routes. |
| **Infrastructure (Vercel, Render, Cloudflare, Neon)** | **Cody** | Raymond for security-relevant config (auth, networking, secrets) | Verifiable in Vercel/Neon/Render audit logs. |
| **Database schema (migrations)** | **Raymond** (security gate) + **Cody** (technical correctness) | James for commercial-impact migrations | Already governed by the 4-gate process in `lib/migrations/runner.ts:380-432`; this policy extends the same gate model to all other changes. |
| **Environment variables / secrets** | **Raymond** (security gate) + **Cody** (operator) | James for any secret above the "Tier 1" line in §6.4 | Tracked in `.env.example` and the Vercel env dashboard. |
| **Vendor relationships** | **James** (commercial relationship) + **Raymond** (security review) | — for Tier 1 vendors, James is non-bypassable | Per the Vendor Risk Management Policy. |
| **AI/ML model changes** | **Raymond** (security + privacy review) | James for commercial decisions | Vision prompts, SAM2 weights, inference thresholds, budget caps. PII review is mandatory. |
| **Pricing, billing, contract terms** | **James** | — | Not security-relevant; out of CISO scope. |
| **Marketing, public comms** | **James** | — | — |
| **Anything P0 (Sev1, PII, customer data)** | **James** (management sign-off) | — | Cannot be bypassed. |

If a role is vacant, the next-most-senior person covers. For 30+ days vacant, James and the remaining role-holder document a temporary delegation in the PR.

### 4.1 The "no silent approvals" rule

Every approval is recorded in the PR with:

- A comment stating one of: `LGTM`, `Changes requested`, `Approved with comments`.
- The control IDs the change affects (e.g. `CC6.6`, `A.8.5`).
- If the change is an exception to a policy, a link to the Linear issue tagged `compliance-exception`.

Slack-based "yeah ship it" is not an approval. Verbal approval during an emergency is a temporary authorization, replaced by a PR review within 24 hours.

## 5. The four gates

Every change passes through four gates before merge. The order is the order.

### 5.1 Gate 1 — Peer review

- At least one reviewer who is not the author.
- For customer-facing changes, Raymond is the reviewer.
- For Tier 1 vendor or PII changes, James is the reviewer.
- The reviewer reads the diff. Approving "on faith" is not approval; reviewers are expected to spot the security, correctness, and PII implications.

### 5.2 Gate 2 — Automated checks

- **TypeScript**: `tsc --noEmit --skipLibCheck` on the changed files. Currently blocked on `strict: false` (P0 in the control matrix); the change is reviewed against the current type regime.
- **Lint**: `next lint` (or `eslint` scoped to changed files) with zero errors. Pre-existing warnings are tolerated only if unrelated.
- **Tests**: `vitest run` scoped to changed files for unit tests; the full suite for migrations and security-sensitive changes. New behavior ships with new tests. The 51 pre-existing F-13 failures and the 9 currently-red tests are tracked in `HANDOFF_F13.md` and are not acceptable as a baseline for new work; new tests must be green.
- **Dependency audit**: `npm audit --audit-level=high` clean for new dependencies. Dependabot security PRs follow the Vulnerability Management Policy cadence.
- **Migration static analysis**: `analyzeRegistryMigration` passes for any change to the migration registry.

### 5.3 Gate 3 — Pre-deploy evidence

- **Vercel preview deploy** is green for any customer-facing change. Preview URLs are linked in the PR.
- **Render pre-deploy** for SAM2 service changes; the build artifact is verifiable in the Render dashboard.
- **Database migration dry-run** for any migration; the `MIGRATE_SECRET` rotation path is documented in `AI-AGENT-README.md §5`.
- **Screenshots or recording** for UI changes; the screenshot links the Vercel preview URL.
- **Test evidence** — for security-sensitive changes, the PR body lists the specific tests that exercise the new code path.

### 5.4 Gate 4 — Post-deploy verification

- The author verifies the change in production within 30 minutes of deploy (smoke test, log check, Sentry signal).
- For migrations, the `MIGRATION-GOV-13` audit log confirms all four gates ran.
- For feature flags, the flag is verified in the expected state (on, off, or per-cohort).
- For Sev1 fixes, the post-incident review (§4.5 of the Incident Response Plan) covers the change.

A change that does not pass Gate 4 within 24 hours is rolled back. The default is "no evidence of working = assumed broken."

## 6. Change-specific requirements

Some categories of change have additional requirements on top of the four gates.

### 6.1 Database migrations

Already governed by the four-gate migration governance in `lib/migrations/runner.ts`. This policy reinforces:

- **Advisory lock** must be acquired before any schema change.
- **Checksum + ledger** must record the migration in `lib/migrations/ledger.ts`.
- **`TARGETED_RECOVERY_ALLOWLIST`** must contain the migration name.
- **Static analysis** (`analyzeRegistryMigration`) must pass; this is what catches the "117 written but unrunnable" failure mode.

Any migration that bypasses one of these gates is a Sev2 incident and triggers a Post-Incident Review.

### 6.2 Environment variables and secrets

- All new env vars are documented in `.env.example` in the same PR that introduces them. The PR is blocked from merge if `.env.example` is not updated.
- Secrets are **never** committed. Pre-commit secret scanning (`gitleaks` or equivalent) is required; the absence of a hook is itself a P0 finding.
- Secret rotation follows the cadence in the (forthcoming) Encryption & Key Management Policy. For now: 90 days for `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `MIGRATE_SECRET`; 365 days for webhook secrets; on-employee-departure for all of the above.
- The Vercel env dashboard is the source of truth for production env vars. The diff between `.env.example` and the Vercel dashboard is checked weekly by the GitHub collector (per `compliance/SELF_BUILT_SETUP.md`).

### 6.3 Rate limits and security thresholds

- Any change to a rate-limit bucket, a CSP rule, a CORS origin, or a CSRF check requires Raymond's review and a test that exercises the new threshold.
- A change that weakens a control is a major version bump for the policy and requires James's sign-off, not just Raymond's.

### 6.4 Vendor and sub-processor changes

- Adding a vendor that handles customer PII is a Tier 1 change under the Vendor Risk Management Policy: requires a signed DPA, a SOC 2 Type 2 report (or equivalent), and James's approval.
- Removing a vendor follows the offboarding checklist in §7 of the Vendor Risk Management Policy: data retrieval, deletion confirmation, credential rotation, and DPA termination.

### 6.5 AI/ML model and prompt changes

- A new model, a new prompt template, a new vision provider, or a new inference threshold requires a PII review (because aerial photos of customer homes may be sent) and a budget cap check (because Opus 4.8 vision is $15/$75 per 1M tokens and runs per-roof).
- The review confirms: (a) the vendor has a signed DPA for the data being sent, (b) the per-day and per-survey cost caps are in place, (c) the fail-loud banner fires when the model is unavailable, (d) the change is documented in `CHANGELOG.md`.

## 7. Rollback

Every change has a rollback plan before it ships. The plan is in the PR description.

| Change type | Default rollback | Time to roll back |
|---|---|---|
| **Vercel deploy** | `vercel rollback` or "Promote Previous Deployment" in the Vercel dashboard. | <2 minutes |
| **Render deploy** | Render dashboard "Roll back to previous deploy." | <2 minutes |
| **Database migration (forward-fixable)** | The migration is forward-fixable by a follow-up migration. Document the forward-fix migration in the PR. | Hours, not minutes |
| **Database migration (destructive)** | Neon PITR to before the migration. See the Backup & Recovery Policy. | <30 minutes for a 7-day PITR window |
| **Feature flag** | Toggle the flag off. | <1 minute |
| **Environment variable** | Vercel env dashboard revert. | <2 minutes |
| **Vendor change** | Re-enable the previous vendor; route traffic back; confirm DPA termination. | Hours, documented in the offboarding checklist |
| **AI/ML model change** | Revert the prompt / model / threshold; the system falls back to the previous behavior. Cache invalidation may be needed. | <5 minutes for the code revert; hours for cache invalidation |

A change without a documented rollback plan is a Normal change, not a Standard change, regardless of the operator's confidence. The plan is part of the PR.

### 7.1 The 30-minute rule

If a deploy shows evidence of customer impact (5xx spike, Sentry alert, customer report) within 30 minutes, the default action is to roll back, not to fix forward. The fix-forward is a follow-up PR with its own four gates.

## 8. Documentation

Every change leaves a paper trail. The trail is the audit evidence.

### 8.1 The PR description

The PR description is the change record. It contains:

1. **What** — a 1-3 sentence summary of the change.
2. **Why** — the problem being solved, the user story, or the incident being fixed.
3. **Control IDs affected** — `SOC 2 CC6.6`, `ISO 27001 A.8.5`, etc.
4. **Risk classification** — Standard / Normal / Emergency.
5. **Rollback plan** — copied from §7.
6. **Test evidence** — list of new and existing tests; preview deploy URL; screenshot or recording.
7. **HANDOFF link** — if this change is the implementation of a HANDOFF doc, the link.

A PR without this structure is not approved.

### 8.2 The HANDOFF_*.md convention

For changes that are part of a planned workstream (F-13, the four-gate migration governance, the Next 15 migration, a vendor onboarding), the change ships with a `HANDOFF_<workstream>.md` file at the repo root per the F-13 convention. The HANDOFF is the human-readable summary; the PR is the machine-readable change record.

For one-off fixes (a typo, a single-line patch, a test fix), the HANDOFF is not required. The PR description is sufficient.

### 8.3 The CHANGELOG entry

Customer-visible changes get a `CHANGELOG.md` entry in the same PR. The entry is short (1-2 lines) and customer-facing-language. The CHANGELOG is the source for the Trust Center "what changed" page and the customer-facing release notes.

Internal-only changes (dependency bumps, refactors, test additions) do not require a CHANGELOG entry. The git log is sufficient.

### 8.4 The audit log

The `auditLog.ts` module records every admin action, every migration run, every auth event. Changes to that module are themselves recorded in the audit log. The audit log is append-only and content-addressed in R2 daily.

## 9. Exceptions

Exceptions to this policy follow the standard exception process in the Information Security Policy §8:

1. **Documented** in a Linear issue tagged `compliance-exception`.
2. **Approved by Raymond** with a stated duration (max 90 days without re-approval).
3. **Disclosed to James** if the exception involves a P0 control, a Sev1-classified incident, or a customer commitment.

For emergency changes, the exception is the verbal approval itself; the Linear issue is filed within 24 hours of the deploy.

## 10. Enforcement

Failure to follow this policy:

- **First occurrence, no customer impact**: coaching + a written note in the personnel file.
- **Repeated or willful violation, or any violation with customer impact**: change rolled back, access to deploys suspended pending HR review.
- **A change shipped without Gate 1 (peer review)**: a Sev3 incident, PIR, and a one-PR cooldown on solo deploys.
- **A change shipped without Gate 4 (post-deploy verification) that caused customer impact**: a Sev2 incident.

## 11. Related documents

- `compliance/policies/01-information-security.md` §5 — risk management approach, exception process.
- `compliance/policies/03-access-control.md` — credential lifecycle, who can deploy.
- `compliance/policies/05-incident-response.md` — when a change is part of an incident response.
- `compliance/policies/07-vulnerability-management.md` — emergency CVE patches.
- `compliance/policies/10-vendor-risk-management.md` — vendor and sub-processor changes.
- `compliance/CONTROL_MATRIX.md` — CC8.1, A.8.9, A.8.25, A.8.28, A.8.32 current state and evidence sources.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection, weekly env-var diff.
- `lib/migrations/runner.ts:380-432` — the four-gate migration governance that this policy extends.
- `AI-AGENT-README.md` §5 — `MIGRATE_SECRET` rotation; §9 — three-check suite.
- `AGENTS.md` — R1 (no push to master), R2 (three-check suite), R6 (commit author).

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the three change types (Standard / Normal / Emergency), the four-gate review process, the approval matrix, and the 30-minute rollback rule. Extends the migration governance to all change categories. |
