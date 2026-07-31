# HANDOFF — Compliance Policies v3 (Sprint 2 Personnel cluster)

**Status:** Drafted, **NOT PUSHED**, awaiting review and signature.
**Author:** Mavis / compliance-lead via legal-writer
**Date:** 2026-08-15
**Per:** F-13 handoff convention (see prior `HANDOFF_*.md` files at repo root).
**Companion to:** `HANDOFF_COMPLIANCE_POLICIES_V1.md` (Sprint 1 foundation, 2026-08-15) and `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (Sprint 1 operations, 2026-08-15).

---

## What was done

Drafted the **5 Personnel-cluster policies** for Solarpro's SOC 2 Type 1 / ISO 27001 / 27701 / 27017 program, in `compliance/policies/`. These join the 5 foundation and 5 operations policies drafted in the prior two handoffs. Total: **15 of 30 policies drafted** (half the program), foundation + operations + personnel complete.

| # | File | Title | Size | Status |
|---|---|---|---|---|
| 11 | `compliance/policies/11-code-of-conduct.md` | Code of Conduct | 17.5 KB | Drafted, awaiting signature |
| 12 | `compliance/policies/12-employee-onboarding-offboarding.md` | Employee Onboarding & Offboarding Policy | 25.5 KB | Drafted, awaiting signature |
| 13 | `compliance/policies/13-security-awareness-training.md` | Security Awareness & Training Policy | 17.7 KB | Drafted, awaiting signature |
| 14 | `compliance/policies/14-background-check.md` | Background Check Policy | 18.6 KB | Drafted, awaiting signature (deferred execution per §7) |
| 15 | `compliance/policies/15-password-authentication.md` | Password & Authentication Policy | 22.0 KB | Drafted, awaiting signature |
| — | `compliance/policies/README.md` | Policy library index | updated | Updated to add the new 5; refreshed "remaining 15" note |

**Total**: 5 new policies + 1 updated index, ~101 KB of new policy content. All in plain English per James's preference for non-preachy direct language (memory: `Info delivery style — non-UI topics`, 2026-07-14).

### Control gaps closed by this batch

The Personnel cluster closes the SOC 2 CC1.4 and ISO 27001 A.6.x control gaps that the auditor will check first in the Type 1 review. These are the "people controls" — the rules that govern how Solarpro hires, trains, treats, and offboards the people who touch the system.

| # | Control(s) | Gap | Closing policy |
|---|---|---|---|
| 1 | **SOC 2 CC1.1, CC1.5; ISO 27001 A.5.1, A.5.4** | No written code of conduct, no values statement, no conflict-of-interest disclosure, no disciplinary process, no annual acknowledgment | **11 Code of Conduct** — mission/values (POL-HR-011 §3), annual disclosure (POL-HR-011 §5), anti-bribery/anti-corruption (POL-HR-011 §6), reporting (POL-HR-011 §9), no-retaliation (POL-HR-011 §10), disciplinary matrix (POL-HR-011 §11), annual acknowledgment (POL-HR-011 §12) |
| 2 | **SOC 2 CC6.2, CC6.3; ISO 27001 A.6.1, A.6.2, A.6.3, A.6.5** | The 24h deprovisioning SLA was embedded in POL-IS-003 §3.3 but the full lifecycle (offer letter, NDA, IP assignment, day-1 provisioning, role changes, knowledge transfer, exit interview) was implicit. The 24h rule was a "hard requirement" the auditor could find but the surrounding process was not documented. | **12 Employee Onboarding & Offboarding** — pre-employment (POL-HR-012 §3), day-1 (POL-HR-012 §4), ongoing (POL-HR-012 §5), the 24h offboarding rule (POL-HR-012 §6, with a worked Friday-5pm example), termination for cause data-recovery review (POL-HR-012 §6.6) |
| 3 | **SOC 2 CC1.4; ISO 27001 A.6.3** | No training register, no training cadence, no tracking artifact, no consequences for missing training | **13 Security Awareness & Training** — training matrix (POL-HR-013 §3), 2-hour security primer (POL-HR-013 §4), role-specific training (POL-HR-013 §5), phishing sim quarterly (POL-HR-013 §6), incident response drill annually (POL-HR-013 §7), training register (POL-HR-013 §8), missing-training escalation |
| 4 | **ISO 27001 A.6.1, A.6.2** | No background check policy. Per James's 2026-07-30 decision, the operating budget does not support a recurring background-check vendor. | **14 Background Check** — the policy is drafted with an explicit "Deferred execution" §7 documenting: the rationale, the interim compensating controls (I-9, reference calls, PIIAA), and the re-evaluation trigger. The policy is the rule; the deferral is the operational reality. |
| 5 | **SOC 2 CC6.1; ISO 27001 A.5.17** | The 32-char machine-secret minimum and the 12+ char user-password rule were enforced in code (recent security quickwins PR + longstanding `app/api/auth/register/route.ts`) but were not consolidated in a single audit-ready document. The MFA matrix was informal. The session / lockout / re-auth rules were scattered. | **15 Password & Authentication** — single source of truth for user password requirements (POL-IS-015 §3), MFA matrix and supported methods (POL-IS-015 §4), 32-char machine secret rule (POL-IS-015 §5), lockout policy (POL-IS-015 §6), session management (POL-IS-015 §7) |

### Design choices (continuing from v1 and v2)

1. **Same header table format** as the foundation and operations five. Policy / Version / Effective date / Owner (CISO) / Approver (Management) / Last reviewed / Next review / Scope — all in the same shape, so the policy library reads as one document.
2. **Concrete, not template.** Raymond, James, Cody. Real systems: Vercel, Neon, Render, OpenAI, Anthropic, Google Solar, Stripe, Cloudflare, GitHub, Sentry, 1Password, WebAuthn / TOTP / SMS. Real incidents referenced where they shape the rule (the 2026-08-12 rate-limiter fail-open drives the fail-closed lockout rule in POL-IS-015 §6).
3. **The 24-hour offboarding rule is a section heading, not buried text.** The 24h rule is a SOC 2 hard requirement. POL-HR-012 §6 leads with it as a block quote, follows it with a worked Friday-5pm example, and tabulates the step-by-step checklist. The auditor can find it in 10 seconds.
4. **The Background Check deferral is its own section, not a footnote.** POL-HR-014 §7 is the deferred-execution note. It names the decision-maker (James), the date (2026-07-30), the rationale (budget), the interim compensating controls (six of them, listed), and the re-evaluation trigger (five named conditions). The auditor sees a working control environment, not a hidden gap.
5. **The 32-char secret minimum is policy, not "what the code does."** POL-IS-015 §5.1 is the rule; the runtime check in `getJwtSecret()` is the enforcement; the weekly env-fingerprint verification is the audit. The rule was added in the recent security quickwins PR; the policy codifies it so the check cannot be regressed.
6. **The 12+ char password rule is policy, not "what the Zod schema does."** POL-IS-015 §3 is the rule; the Zod schema in `app/api/auth/register/route.ts` is the enforcement; the UAR is the audit. NIST 800-63B is the cited basis.
7. **The training register is operational, not aspirational.** POL-HR-013 §8 names the file (`compliance/training/register.csv`), the schema, the review cadence (1st business day of each month), and the escalation for overdue training (0-30d / 30-60d / 60-90d / >90d). For the 3-person team, a CSV is enough; the policy also names the LMS trigger (10+ people) so the future state is planned.
8. **Cross-references to the control matrix are explicit.** Every policy's "Related documents" section names the specific control IDs the policy satisfies. The full mapping remains in `compliance/CONTROL_MATRIX.md`.
9. **The exception process is consistent across all 15.** Linear issue tagged `compliance-exception` → Raymond approval → 90-day max → James disclosure for P0. The Information Security Policy §8 is the root.

### Policy-specific design notes

- **11 Code of Conduct** has the most-asserted paragraph in the policy library (POL-HR-011 §10 — no retaliation). The policy is split into the values (§3), the expectations (§4), the conflict-of-interest rules (§5), the anti-bribery rules (§6), the confidentiality / IP rules (§7), the regulatory rules (§8), the reporting channels (§9), the retaliation rule (§10), the disciplinary process (§11), and the annual acknowledgment (§12). The "no commercial rationale exception" line at the end of §6 is the line the auditor will read twice — it's the rule that says there is no business case that overrides anti-bribery.
- **12 Employee Onboarding & Offboarding** is the largest of the five (25.5 KB). It has to be — the policy is the full lifecycle from offer letter to post-termination records retention. The day-1 account provisioning table in §4.1 names every account a new hire gets; the offboarding checklist in §6 is the SOC 2 hard requirement evidence. The §6.6 termination data-recovery review is the rule that prevents a 2026-08-12-style incident from recurring on a termination.
- **13 Security Awareness & Training** scales to the 3-person team in §9. The training matrix in §3 names every training the team needs; the §9 reality section names what each of James, Raymond, and Cody actually does in 2026. The training register at `compliance/training/register.csv` is the operational artifact.
- **14 Background Check** is the unusual one — it has a "what should happen" policy (§2-§6) and a "what is happening today" deferral note (§7). Both are in the same document. The deferral is the policy, not a gap in the policy. The auditor reads §7 and sees: a working control environment, a named decision-maker, a documented rationale, interim compensating controls, and a re-evaluation trigger.
- **15 Password & Authentication** is the technical rulebook. It pulls together: NIST 800-63B (12+ chars, no composition rules, no forced rotation), the 32-char machine secret minimum, the MFA matrix, the supported methods (WebAuthn > TOTP > Push > SMS), the lockout policy (5 fails = 15-min lockout, escalating), the session policy (8h admin / 24h user), and the re-authentication policy (5-min window for sensitive ops). The §10 3-person team reality section names what each of James, Raymond, and Cody actually uses today.

## What needs to happen next

### Who reviews

- **Raymond O'Brien (CISO)** reviews the technical accuracy of all 5 policies. Estimated time: 75-100 minutes total (the Employee Onboarding & Offboarding policy is the longest; the Background Check policy is the most consequential because of the deferral).
- **James Carpenter (CEO)** reviews for management sign-off and merges. Estimated time: 25-35 minutes for a skim if Raymond's review is clean. The Code of Conduct is the one James reads most carefully — the values, the conflict of interest, and the disciplinary process are the management-discipline document.
- **Cody (technical lead)** reviews the technical implementation aspects of:
  - **12 Employee Onboarding §4.1** — confirm the day-1 account list matches what he would actually provision.
  - **13 Security Awareness §5.1** — confirm the secure coding training covers the topics he would expect.
  - **15 Password & Authentication §4-§7** — confirm the technical rules match what the code actually does (especially the 32-char runtime check, the MFA enforcement, and the session / lockout behavior).

Cody is in the review loop for these three. The other two (11 Code of Conduct, 14 Background Check) are not blocking on his review.

### What James needs to do

1. **Open a PR** titled `policy: personnel cluster (11-15)` (or similar) that includes all 6 files (5 policies + 1 README update). Suggested base branch: `master`. Suggested reviewer: `raymond` (GitHub handle).
2. **Tag Raymond** for review. He has 2-3 business days for this batch (the Personnel cluster is denser than Operations because of the day-1 checklist and the offboarding procedure).
3. **Tag Cody** for the three policies where his review is in the loop (12, 13, 15). He has 1-2 business days.
4. **After Raymond's LGTM and Cody's reviews**, James merges. The merge commit is the audit artifact.
5. **Collect wet signatures** (or DocuSign equivalent) for the v1.0 signature blocks. Same process as the foundation and operations batches. Estimated time: 5 minutes per policy × 5 policies = 25 minutes.
6. **Update the policy headers** post-merge: change "Last reviewed" from 2026-08-15 to the merge date, leave "Next review" as 2027-08-15.
7. **Announce in Slack** (#announcements or team channel): "5 personnel policies are live. Read 11 (Code of Conduct — everyone), 12 (Onboarding/Offboarding — for hiring managers), 15 (Password & Authentication — everyone, especially the lockout / MFA rules)."
8. **Trigger the first annual cycle** (per Code of Conduct §12): the first Code of Conduct acknowledgment cycle is due **2027-08-15**. Add a calendar reminder 30 days out.

### What Raymond needs to do

1. **Review each policy** for technical accuracy. The big things to check:
   - **11 Code of Conduct**: the values in §3 match his mental model. The conflict-of-interest disclosure in §5 catches what it needs to catch. The anti-bribery rule in §6 is consistent with FCPA + state law. The reporting channels in §9 work (especially the `conduct@solarpro.app` alias and the anonymous mailing address). The disciplinary process in §11 is enforceable. The annual acknowledgment in §12 is sized to a 3-person team.
   - **12 Employee Onboarding & Offboarding**: the day-1 account list in §4.1 matches what he actually provisions. The day-1 checklist in §4.2 is operationally realistic. The quarterly policy review huddle in §5.1 is sustainable at 30 minutes. The 24h offboarding rule in §6 is operationally realistic (the Friday-5pm example is the right worked example). The §6.6 termination data-recovery review is the rule he wants to operate against.
   - **13 Security Awareness & Training**: the training matrix in §3 captures the training that actually exists. The 2-hour security primer in §4 is the right scope. The secure coding training in §5.1 covers the topics he would expect (OWASP Top 10, JWT, RBAC, input validation, secrets, dependency security, crypto, logging, threat modeling). The phishing simulation in §6 is realistic and the click-vs-report rule is right. The incident response drill in §7 is the right format.
   - **14 Background Check**: the §7 deferred-execution note is accurate to his understanding of the 2026-07-30 decision. The interim compensating controls in §7.2 are the actual ones in use. The re-evaluation trigger in §7.4 is the right set of conditions. The policy is enforceable when budget permits (§2-§6 are the rules; §7 is the current-state label).
   - **15 Password & Authentication**: the 12+ char rule in §3 is consistent with `app/api/auth/register/route.ts`. The breach-dictionary check in §3.2 is the HIBP k-anonymity check (planned, not yet implemented). The MFA matrix in §4.1 is the actual matrix (admin / production / source / cloud all require MFA). The 32-char secret minimum in §5.1 matches the runtime check in `getJwtSecret()`. The lockout policy in §6 is fail-closed in production. The session policy in §7 matches the middleware behavior (8h admin / 24h user). The re-authentication policy in §7.3 covers the sensitive operations correctly.
2. **Leave a comment in the PR** with any changes. If no changes, "LGTM."

### What Cody needs to do

Review the technical implementation aspects of:

- **12 Employee Onboarding §4.1** (the day-1 account provisioning table) — confirm he would provision exactly this list, in this order, on day 1.
- **13 Security Awareness §5.1** (the secure coding training topics) — confirm the topics cover the Solarpro-specific concerns. The 2h hands-on exercise (the deliberately vulnerable PR sandbox) is the right shape.
- **15 Password & Authentication §4-§7** (the technical auth rules) — confirm the runtime enforcement matches the policy. The 32-char check in `getJwtSecret()`, the MFA enforcement in `lib/auth.ts` and `lib/adminAuth.ts:152`, the session / lockout behavior in `middleware.ts`, and the re-authentication window in the route handlers.

Cody is in the review loop for these three. The other two (11, 14) are not blocking on his review.

## The Background Check deferred-execution note

This is the single most important thing in this handoff. The Background Check Policy is drafted with a "deferred execution" rather than a fake claim that the check is happening. The deferral is documented honestly because the alternative — claiming a check is happening when it is not — is worse than admitting the gap.

### What the policy says

POL-HR-014 §7 states:

- **What is not happening today** (§7.1): the vendor is not selected, the full check is not being run, the annual re-check is not being run, the §3 components are not being verified by an independent vendor.
- **What is happening today** (§7.2, the interim compensating controls): I-9 identity verification, informal reference calls, the PIIAA / NDA / Code of Conduct contractual liability, the "I know them personally" judgment that applies to a 3-person team, the annual conflict-of-interest disclosure, the quarterly UAR.
- **The rationale for the deferral** (§7.3): James's 2026-07-30 decision, "no money for background checks yet, but the policy should still exist."
- **The re-evaluation trigger** (§7.4): five named conditions (budget supports a vendor, team >5, new jurisdiction requires, security incident or near-miss, auditor finding).
- **The auditor's view** (§7.5): five things the auditor sees — the policy exists, the deferral is documented, the compensating controls are described, the re-evaluation trigger is named, the decision-maker is named.

### Why the deferral is the right posture

Three reasons:

1. **An auditor who sees a deferred policy with compensating controls and a re-evaluation trigger is looking at a working control environment.** A control environment is not "every control is fully implemented"; it is "we know what controls we have, what controls we don't, and what we are doing about it." The deferral is the "what we don't" answer, and it is the right answer.
2. **A fake background check is worse than no background check.** A claimed check that doesn't happen is a fraud on the auditor. If the auditor discovers it during the field work, the entire Type 1 report is at risk. The deferral is the truthful position; the truth is what the auditor will accept.
3. **The deferral is re-evaluable.** When the budget supports a vendor, the policy becomes operational by selecting the vendor and triggering the check. The five conditions in §7.4 are the re-evaluation triggers. The audit evidence of a deferred-then-activated policy is the strongest possible: the policy existed, the rationale was documented, the interim controls were described, and the activation happened when the trigger fired.

### What James needs to do about it

Nothing immediate. The deferral is the policy. The auditor's response to a deferred-execution note is determined by the quality of the documentation, and the documentation in POL-HR-014 §7 is the quality the auditor expects.

When any of the §7.4 re-evaluation triggers fires, the policy is updated (revision history row, control matrix status change from "Partial (deferred)" to "Partial (vendor selected)" to "Implemented (operational)") and the check begins. The expected trigger order is:

1. **Budget supports a vendor** (most likely first, the operating budget is the binding constraint today).
2. **Team >5** (likely second, headcount growth is the next 12-18 month trajectory).
3. **Auditor finding** (possible if the auditor disagrees with the deferral).
4. **New jurisdiction or customer contract** (possible if Solarpro expands to a regulated geography).
5. **Security incident or near-miss** (least likely, but the trigger exists).

The first re-evaluation is due on the policy's annual review date (2027-08-15) regardless of whether a trigger has fired.

## What's left in the 30-policy program (15 more)

15 of 30 policies are drafted (5 foundation + 5 operations + 5 personnel). The remaining 15 are scoped for Sprint 2 (2026-09-03 → 2026-10-15) per `compliance/PROGRAM.md` §5. The list, grouped by area, is below. The list is the same as the prior handoffs minus the 5 done in this batch.

### Information Security (2 remaining)

- **Encryption & Key Management Policy** — the secret-rotation cadence referenced in 06, 09, and 15 needs a home. The 32-char minimum is in 15 §5; the rotation cadence is in 15 §5.3 but the operational procedure (how to rotate, how to verify, how to test) is not yet written.
- **Acceptable Use of Cloud Services Policy** — narrower than 01; covers the cloud-specific acceptable use (Vercel preview environments, Neon branches, Render sandbox, Cloudflare DNS edits).

### Operations (2 remaining)

- **Business Continuity & Disaster Recovery Plan** — the tabletop and the multi-system outage scenario. Pairs with 09 Backup & Recovery. Adds the RTO/RPO commitments to the full system, not just the database.
- **Patch Management Policy** — OS patching on developer endpoints, base Docker image patching for SAM2. The vendor side is in 07. The endpoint side is in 02 today.

### Vendor & Third Party (2 remaining)

- **Third-Party Service Provider Policy** — narrower than 10; covers one-off contractors and freelance engagements (the "no PII, no production access" exclusion in 14 §2 is the closest existing reference).
- **Software Bill of Materials (SBOM) Policy** — the SBOM generation cadence, the SBOM distribution policy, the relationship to the dependency tree that 07 manages.

### Privacy / ISO 27701 (4)

- **Privacy Policy (external-facing)** — for the `/privacy` route on the public site. Pairs with the Privacy Impact Assessment Policy.
- **Data Subject Rights Policy** — access, correction, deletion, portability per GDPR Art. 15-20. The 72h breach clock is in 05; the 30-day data-subject-rights clock is the new content.
- **Data Retention & Disposal Policy** — the 7-year audit retention is in 09 and 04; this expands to the full data lifecycle (Neon scheduled deletion jobs, Sentry scrubbing cadence, Google Workspace retention rules, the cryptographic erasure procedure).
- **Privacy Impact Assessment Policy** — the PIA trigger conditions and the PIA template.

### Cloud / ISO 27017 (3)

- **Cloud Services Security Policy** — the cloud-specific layer; 10 covers vendors generally, this covers the cloud-deployment layer.
- **Shared Responsibility Matrix** — names Vercel, Neon, Render, Cloudflare responsibilities vs. Solarpro's. The auditor will ask for this explicitly under ISO 27017.
- **Virtual Environment Security Policy** — the Vercel preview environment, the staging Neon project, the SAM2 sandbox.

### Compliance & Audit (3)

- **Risk Assessment Policy** — the methodology behind the risk register that 01 §5 references. Lightweight per the 3-person team scale.
- **Statement of Applicability (SoA)** — required for ISO 27001. The manifest at `compliance/manifest.json` is the input; the SoA is the output.
- **Audit & Monitoring Policy** — the SOC 2 / ISO 27001 audit cadence, the internal audit function, the auditor-access flow.

### Total: 15 remaining. Sprint 2 timeline: 2026-09-03 → 2026-10-15. Estimated effort: ~38 person-hours (the 15 done in the three batches are ~63 hours; the remaining 15 are lighter per policy, with the privacy and cloud clusters being the densest). Owner: legal-writer agent, with Raymond as the technical reviewer.

## The CISO review process

The Personnel cluster is the third batch to use the CISO-as-reviewer pattern. The process is now stable across foundation, operations, and personnel; the same review checklist applies.

### Per-policy review SLA

| Policy type | Review SLA | Sign-off SLA | Total wall time |
|---|---|---|---|
| **Lightweight** (one-paragraph scope, low-control-count) | 1 business day | 0.5 business day | 1.5 business days |
| **Standard** (the foundation and operations clusters) | 2-3 business days | 0.5-1 business day | 3-4 business days |
| **Heavyweight** (Personnel — Code of Conduct, Onboarding/Offboarding) | 3-5 business days | 1-2 business days | 5-7 business days |
| **Future heavyweight** (Privacy, BC/DR, SoA) | 3-5 business days | 1-2 business days | 5-7 business days |

The Personnel cluster is heavier than Operations because of the day-1 checklist (12), the training register (13), and the deferred-execution note (14).

### The review checklist

For every policy, Raymond's review confirms:

1. **Technical accuracy** — does the policy describe how the system actually works?
2. **Control coverage** — does the policy's "Related documents" section name the right control IDs?
3. **Operational realism** — can a 3-person team actually operate against this policy at the cadence it describes?
4. **Audit acceptability** — would an auditor read this and find the evidence they need?
5. **Cross-references** — does the policy reference the foundation policies (01-05) and the operations policies (06-10) correctly?

For the Personnel cluster, the additional checks are:

6. **People-process realism** — does the lifecycle (offer letter → day 1 → ongoing → offboarding) match the actual flow? Is the day-1 checklist sized to a Tuesday-morning 2-hour block?
7. **Training realism** — is the training cadence one that a 3-person team can sustain? Is the training register at `compliance/training/register.csv` the right operational artifact?
8. **Deferral honesty** — for the Background Check Policy, is the §7 deferred-execution note accurate to the 2026-07-30 decision?

Raymond's review comment is one of: `LGTM — no changes needed`, `Changes requested: <list>`, or `Approved with comments: <list>`. The PR is the review record; the comment is the audit artifact.

### The escalation path

A review comment that Raymond and the policy author (the agent team) cannot resolve in 2 review cycles is escalated to James. James's call is final. The escalation is documented in the PR thread.

### The "blocked" path

A policy that cannot be signed off within 4 review cycles (about 2 weeks) is parked and the gap is documented in `compliance/PROGRAM.md` §9. The auditor will see the gap, the rationale, and the remediation timeline. Parking is better than letting an unsigned policy ship and create a control-environment gap.

## Risks and open questions

1. **The Employee Onboarding & Offboarding Policy §6.6 termination data-recovery review** is a significant new operational discipline. The first time it runs, it will surface at least one "we should have caught this" finding. The discipline is the point. Recommend running a tabletop of the data-recovery review in the next quarterly policy review huddle, with a non-critical scenario (e.g. "the marketing intern's contract ended last week — what would the data-recovery review look like?") to exercise the procedure before it is needed for real.

2. **The Security Awareness & Training Policy §8 training register** assumes a CSV at `compliance/training/register.csv`. The CSV is not yet created. Recommend creating it as a Sprint 1 follow-up (the first three rows are the three team members' on-record 2026-08-15 security primer completion; subsequent rows are the quarterly phishing sims and the annual refreshers).

3. **The Password & Authentication Policy §3.2 HIBP k-anonymity check** is the de facto industry standard but is not yet in the codebase. The runtime check is a future sprint task (the 32-char check from the security quickwins PR is the analog). The policy codifies the requirement; the implementation follows.

4. **The Code of Conduct §9 anonymous mailing address** ("Personal and Confidential — To Be Opened by Raymond O'Brien and James Carpenter Only" mailed to the registered agent in Illinois) is the operational mechanism for anonymous reports. The registered agent address is the address on file with the Illinois Secretary of State; it should be confirmed against the actual filing before the policy is published. Recommend a 5-minute check before the PR merge.

5. **The Background Check Policy §7.4 re-evaluation trigger** is the 5 named conditions. The first re-evaluation is due 2027-08-15 regardless of whether a trigger has fired. Add a calendar reminder 30 days out.

6. **The "Last reviewed 2026-08-15"** date in the policy headers reflects the drafting date. The actual review (and last-reviewed date) is the PR merge date. Same convention as the v1 and v2 batches. Update the headers as a post-merge commit.

7. **The Code of Conduct §6 gifts-and-hospitality log** at `compliance/gifts-log/` does not yet exist. Recommend creating an empty directory + a CSV template as a Sprint 1 follow-up. The first cycle (2026-2027) will likely be empty; that's fine — the log is the audit artifact.

8. **The Password & Authentication Policy §5.3 secret rotation** cadence is documented at the policy level; the operational procedure (how to rotate, how to verify, how to test) is in the forthcoming Encryption & Key Management Policy. The rotation cadence is enforceable; the procedure is the Sprint 2 follow-up.

9. **The 3-person team scaling assumption** is that all 5 Personnel policies scale linearly. At 5 people, the cadence holds. At 10, the LMS replaces the CSV; the technical policies do not change. At 20, the day-1 checklist becomes a 1-day onboarding program; the security primer becomes a 1-day training. The policies flag the scaling trigger; the future-state plans are not yet written.

10. **The cross-reference discipline is rigorous across all 15 policies.** The 5 new policies each reference the relevant foundation and operations policies by file name and section. The 10 existing policies do not yet reference the 5 new ones. Recommend a follow-up PR in Sprint 2 that adds "Related documents" cross-references in the foundation and operations policies to the Personnel policies. This is a 1-hour task; it tightens the library but is not a blocker on the v3 merge.

## Files written

```
C:\Users\carpe\Solarpro\
├── compliance\
│   └── policies\
│       ├── 11-code-of-conduct.md
│       ├── 12-employee-onboarding-offboarding.md
│       ├── 13-security-awareness-training.md
│       ├── 14-background-check.md
│       ├── 15-password-authentication.md
│       └── README.md            (updated to add the new 5)
└── HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md   (this file)
```

## Cross-references

- `HANDOFF_COMPLIANCE_POLICIES_V1.md` — the foundation batch (2026-08-15).
- `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` — the operations batch (2026-08-15).
- `compliance/PROGRAM.md` §5 — full 30-policy scope, 15 done in Sprint 1 + 2 batches.
- `compliance/CONTROL_MATRIX.md` — 78 controls, current state, evidence sources, P0 gap remediation table.
- `compliance/SELF_BUILT_SETUP.md` — evidence collection architecture.
- `compliance/SECURITY_ADVISORY_DEPS.md` — the dependency advisory that policy 07 operationalizes.
- `app/api/auth/register/route.ts` — the runtime enforcement of the 12+ char password rule (POL-IS-015 §3).
- `lib/auth.ts`, `lib/adminAuth.ts` — the runtime enforcement of the auth rules in POL-IS-015 §4-§7.
- `getJwtSecret()` and equivalents — the runtime enforcement of the 32-char machine secret rule (POL-IS-015 §5.1).

---

**End of handoff. Authored 2026-08-15. Awaiting Raymond's review and James's merge.**
