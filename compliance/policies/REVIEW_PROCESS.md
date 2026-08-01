# Policy Review Process

How policies in this directory get reviewed, approved, and versioned. This document is the operating procedure that backs the "annual + on material change" cadence in the Information Security Policy §7.

## 1. Review triggers

A policy is reviewed when any of the following is true:

| Trigger | Source | Cadence |
|---|---|---|
| **Annual** | The "Next review" date in the policy header has passed. | Once per year, by the month shown in the policy. |
| **Material change** | A Sev1 security incident. A new sub-processor handling PII. A change in role assignments (CISO, management sign-off). A new framework in scope. Ownership change of more than 25% of the company. | Within 30 days of the trigger event. |
| **Control matrix drift** | A new gap, partial, or implemented status change in `CONTROL_MATRIX.md` that affects a control the policy addresses. | When the matrix changes. |
| **External** | A new regulatory requirement, a customer contract clause that tightens a control, or an auditor finding. | When surfaced. |

## 2. Review procedure

The review is a **pull request**. There is no separate workflow.

1. **Open a PR** titled `policy: review <policy-name> v<N>` against `master`. The PR body must contain:
   - A 2-3 sentence summary of the change
   - The trigger (annual, material change, control matrix drift, external)
   - A diff of substantive changes (whitespace-only changes don't need a PR body explanation)
   - The control IDs affected (e.g. SOC 2 CC6.6, ISO 27001 A.8.5)
   - A `## Revision history` entry proposed in the policy

2. **Raymond reviews** the technical accuracy and the control coverage. His review must explicitly state one of:
   - `LGTM — no changes needed`
   - `Changes requested: <list>`
   - `Approved with comments: <list>`

3. **James approves and merges.** As the management sign-off, James's approval is the final sign-off. The merge commit is the audit artifact of the policy version.

4. **Update the policy header.** The "Last reviewed" date becomes the merge date. The "Next review" date advances by one year (or stays sooner if a tighter cadence is needed). The "Revision history" table gets a new row with the version bumped (1.0 → 1.1 for a minor change, 1.x → 2.0 for a substantive rewrite).

5. **Notify the team.** A short Slack message in `#announcements` (or the team channel) with a one-line summary: "Information Security Policy v1.1 approved — changes: clarified exception duration."

## 3. Signatures

For **v1.0** (initial issuance), both signatures are collected physically or via a DocuSign equivalent. The signature block in each policy has two lines:

- **CISO (Owner)**: Raymond O'Brien
- **CEO (Management sign-off)**: James Carpenter

For **subsequent versions**, the PR approval workflow substitutes for a wet signature — the merge commit records both approvers' GitHub usernames. A wet signature is only needed if a customer contract or auditor specifically asks for one (rare; SOC 2 and ISO 27001 accept git-based approval trails).

## 4. Audit trail

The complete audit trail for any policy is:

1. **Git history** — every version of the file, with the author and commit message.
2. **PR history** — every review, comment, and approval.
3. **Revision history table** in the policy itself — the human-readable summary.
4. **Merge commit SHA** — referenced in the revision history; this is the canonical "this version was approved on this date" record.
5. **R2 evidence bucket** — a daily snapshot of the `compliance/policies/` directory is stored at `evidence/github/<date>/policies-snapshot.json` by the GitHub collector. This is a content-addressed copy that survives any future git history rewrite (e.g. force-push, repo migration).

## 5. Exceptions

A policy exception (departing from a control in a policy) is **not** a policy change. It is documented separately:

- Linear issue tagged `compliance-exception` with the policy, the control, the justification, the duration, and the compensating control.
- Approved by Raymond (CISO) with a maximum 90-day duration. Renewable.
- Disclosed to James if the exception involves a P0 control, a Sev1-classified incident, or a customer commitment.

The exception list is reviewed quarterly as part of the UAR cycle.

## 6. Archiving and retention

- **Superseded policies** are not deleted from git. They live in history.
- A note in the README `## Status legend` indicates when a policy is superseded.
- Retention is **7 years** from the date of supersession, matching the audit log retention in the Data Classification & Handling Policy §6.1.

## 7. The annual review calendar

A useful reference for the next 12 months. Dates are approximate; the actual "Next review" is in each policy's header.

| Policy | Approximate review month | Owner |
|---|---|---|
| Information Security Policy | August (foundational, sets cadence) | Raymond + James |
| Acceptable Use Policy | August | Raymond |
| Access Control Policy | August | Raymond |
| Data Classification & Handling Policy | August | Raymond |
| Incident Response Plan | August (or after any Sev1) | Raymond |
| Remaining 25 policies (Sprint 2) | TBD by month — staggered so the load is even | Raymond |

The cadence is staggered so no single month has more than 2-3 policy reviews. After the foundation is in place, the cycle is sustainable at ~30 minutes per policy per year.

## 8. What is NOT a policy review

To keep the signal high:

- A typo fix, broken link, or formatting change is a direct commit. No PR review needed; just a clean commit message.
- A clarification that does not change the meaning is a minor version bump (1.0 → 1.1) with a one-line revision history entry.
- A substantive change (new control, new requirement, new scope) is a major version bump (1.x → 2.0) with a full PR review.
- An addition of a related document or external reference is a minor version bump.

## 9. Related documents

- `compliance/policies/README.md` — the policy index.
- `compliance/policies/01-information-security.md` §7 — the policy-of-policies cadence.
- `compliance/CONTROL_MATRIX.md` — the control mapping that policies reference.
- `compliance/PROGRAM.md` — the broader compliance program timeline.
