# Patch Management Policy

| Field | Value |
|---|---|
| **Policy** | POL-OP-023 — Patch Management Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change (new framework, new vendor, new patch class) |
| **Scope** | Every software dependency, runtime, OS image, and infrastructure component that Solarpro depends on in production. Includes npm packages, Python packages, Docker base images, the Node.js and Python runtimes, the Vercel/Render/Neon platform runtimes, the browser-side libraries, and the OS-level packages on developer laptops (the endpoint policy is the Acceptable Use Policy #02; this policy covers the dependency and runtime side). |

---

## 1. Purpose

This policy is the rule for **how Solarpro finds, assesses, prioritizes, applies, and verifies patches** for the software that runs the application, the services, and the development toolchain. It's the **SOC 2 CC7.1 + ISO 27001 A.8.8 + A.8.9 + A.12.6** evidence: that Solarpro has a documented patch cadence, that the cadence is tied to severity, that the exceptions are documented, and that the emergency path (the actively-exploited CVE) has a 24-hour SLA.

The 2026-07-30 control matrix row A.8.8 (Management of technical vulnerabilities) was **Gap**: 5 high-severity Next.js 14 DoS CVEs were unpatched, no `npm audit` in CI, no Dependabot security updates, and `package-lock.json` was 9 days stale. The Stage 2 of the Next 15 migration (commit on `chore/next-15-migration`, not pushed) closed all 5 CVEs. This policy codifies the cadence that keeps the CVEs from coming back.

The Vulnerability Management Policy (#07) covers **how we discover and assess vulnerabilities** — the threat-intel feed, the `npm audit`, the Dependabot alerts, the asset inventory. This policy covers **how we act on the assessment** — the severity classification, the SLAs, the remediation workflow, the exception process, the emergency path, the verification. The two policies are read together; the discovery side feeds the action side.

The 3-person team constraint is real. The patch workflow is asynchronous-by-default: Dependabot opens a PR; a human reviews it; the merge happens in the normal PR cadence. The emergency path is the only synchronous path — a 24-hour SLA for an actively-exploited CVE. The §6 procedure is designed so a single engineer (Cody) can drive it end-to-end, with Raymond as the CISO reviewer and James as the management sign-off.

## 2. Principles

Five principles, in priority order.

1. **Patch by default, exception by choice.** The default action on a new CVE is to patch. The exception process is documented in §7; the burden of proof is on the exception, not the patch.
2. **Severity drives SLA.** A critical CVE has a 24-hour SLA. A high-severity CVE has a 7-day SLA. A medium has 30 days. A low has the next cycle. The severity classification is per §5, with CISA KEV (Known Exploited Vulnerabilities) as a special case that bypasses the normal review (§6.4).
3. **The fix is in the diff, not in the head.** A patch that is not merged is a hope, not a patch. The §6 workflow ends with a merged PR, a deployed fix, and a verification. Anything less is a violation of the policy.
4. **Exceptions are time-bound and reviewed.** An exception (a patch that cannot be applied today) has a re-evaluation date no more than 90 days out. The exception is in the §7 register, not in someone's head.
5. **The emergency path bypasses review, not accountability.** An emergency patch (a KEV CVE) skips the normal review cycle but lands in the same audit trail. The §6.4 procedure is fast and loud, not silent.

## 3. Scope

This policy applies to every software component that runs in production or that the production build depends on. The list is not exhaustive; the framework applies to any new component added to the stack.

### 3.1 Application dependencies (npm)

- The Next.js application at `app/`, the worker at `worker/`, the SAM2 service at `sam2-service/`, and every other JavaScript / TypeScript codebase in the repository.
- Every `dependencies` and `devDependencies` entry in `package.json`, including transitive dependencies.
- The Node.js runtime version (pinned in `.nvmrc` and the Vercel project settings).
- The npm lockfile (`package-lock.json`) is committed to git and is the source of truth for the exact installed versions.

### 3.2 SAM2 service dependencies (pip)

- The Python service at `sam2-service/`, the worker at `worker/` (the Python parts), and every other Python codebase.
- Every `requirements.txt` entry, including transitive dependencies.
- The Python interpreter version (pinned in `sam2-service/runtime.txt` or the Docker base image).
- The pip lockfile (`requirements.lock` or `pip-compile` output) is committed to git.

### 3.3 Docker base images

- The SAM2 service Dockerfile (the base image, the multi-stage build).
- Any future service Dockerfiles.
- The base image is pinned by digest (`@sha256:...`); an image tag update is a separate, reviewed change.

### 3.4 Platform runtimes

- The Vercel runtime (Node.js version, the Next.js adapter).
- The Render runtime (Python version, the Docker base).
- The Neon Postgres version (the Neon-managed Postgres).
- These are vendor-managed; Solarpro's job is to track the vendor's deprecation notices and to upgrade before the cutoff.

### 3.5 Browser-side libraries

- The Next.js bundle, the React runtime, the charting libraries (recharts, three.js, cesium).
- Same SLA as the npm dependencies. The browser-side library is a transitive npm dependency, so the Dependabot PR covers it.

### 3.6 Developer laptop OS and tooling

- Out of scope for this policy. The Acceptable Use Policy (#02) and the Endpoint Security section of the Cloud Services Security Policy (#24) cover the OS, the browser, the password manager, the antivirus, and the disk encryption.

### 3.7 Out of scope

- The customer's browser and OS (the customer's responsibility, not Solarpro's).
- The cloud provider's internal infrastructure (Vercel's edge, Neon's storage layer, Cloudflare's network) — these are vendor-managed and are covered by the vendor's SOC 2 report.
- The OS kernel on the Neon compute (Neon manages the OS).
- The OS kernel on the Render Docker host (Render manages the host).

## 4. Detection sources

Patches cannot be applied if the vulnerabilities are not known. Solarpro uses five detection sources, in priority order. The list is the operational complement of the Vulnerability Management Policy (#07) §4.

### 4.1 Dependabot (GitHub)

- **What it does**: GitHub's automated dependency scanner. Opens a PR for every new advisory that affects a tracked dependency. Runs on a daily schedule plus a real-time check on every push.
- **What it covers**: every npm and pip package in the repository, plus the GitHub Actions versions.
- **What it does not cover**: transitive dependencies that are not in the lockfile, OS-level CVEs, vendor-managed runtimes.
- **The PR lands in the repository**: the Dependabot PR is the entry point for the §6 workflow. The PR is auto-assigned to the code owner; the next step is review and test.

### 4.2 GitHub Security Advisories (real-time)

- **What it does**: GitHub's database of CVEs, automatically matched against the repository's dependencies.
- **What it covers**: every CVE that GitHub has cataloged, regardless of whether Dependabot has opened a PR yet.
- **The alert lands in the Security tab**: the alert is reviewed in the §6 triage, even if Dependabot has not yet opened a PR.

### 4.3 Snyk (weekly)

- **What it does**: Snyk's deep dependency scanner, with a broader CVE database and transitive reach than Dependabot.
- **What it covers**: npm, pip, Docker base images, IaC files.
- **Cadence**: weekly scan on the `master` branch + every PR. The scan runs in GitHub Actions; the results land in the Sentry and Slack alerts.
- **Note**: Snyk is a paid tool. Solarpro uses the free tier for the weekly scan on critical paths; the Dependabot + GitHub Security Advisories cover the rest. A paid Snyk upgrade is a Sprint 3+ decision.

### 4.4 NVD CVE feed (weekly digest)

- **What it does**: the National Vulnerability Database, the canonical CVE source.
- **What it covers**: every CVE, regardless of ecosystem.
- **Cadence**: weekly digest, generated by the NVD feed and reviewed by Raymond in the weekly monitoring review.
- **What it does not catch**: the CVE-to-package mapping is manual; the digest is a list of CVEs to investigate, not a list of CVEs to patch.

### 4.5 Vendor security bulletins

- **What it does**: the security advisories published by the Tier 1 vendors (Vercel, Neon, Render, Cloudflare, Stripe, OpenAI, Anthropic, Google Solar, Resend, Sentry).
- **What it covers**: CVEs and incidents in the vendor's stack that may affect Solarpro.
- **The bulletin is reviewed in the weekly monitoring**: Raymond reviews the bulletins and decides if any require a Solarpro-side action.

## 5. Severity classification

The classification is the input to the §6 SLA. The classification uses the CVSS base score as a starting point, with three adjustments:

1. **CISA KEV listing bumps the severity to Critical.** A CVE in the CISA KEV catalog is treated as Critical regardless of the CVSS score, because there is evidence of active exploitation.
2. **Reachability bumps the severity up.** A CVE in a package that is loaded by the application is more severe than the same CVE in a package that is dev-only. The reachability assessment is part of the §6.2 review.
3. **Customer data exposure bumps the severity up.** A CVE in a code path that handles customer PII is more severe than the same CVE in a code path that does not.

| Severity | CVSS range (default) | SLA | Example |
|---|---|---|---|
| **Critical** | 9.0-10.0, OR CISA KEV | **24 hours** | Remote code execution, authentication bypass, actively-exploited CVE |
| **High** | 7.0-8.9 | **7 days** | Privilege escalation, sensitive data exposure, persistent XSS |
| **Medium** | 4.0-6.9 | **30 days** | Reflected XSS, information disclosure with low impact, DoS with limited impact |
| **Low** | 0.1-3.9 | **Next cycle** | CVEs in dev-only tools, CVEs with no reachable code path, CVEs with no practical impact |

The SLAs are from the **discovery date** (the Dependabot PR date, the GitHub Security Advisory date, or the Snyk finding date), not from the CVE publication date. The discovery date is logged in the §8 records.

## 6. Remediation workflow

The workflow is the operational rule for moving a patch from "discovered" to "deployed and verified." Every step has an owner, a time bound, and an output.

### 6.1 The normal workflow (Critical, High, Medium, Low)

| Step | Owner | Time bound | Output |
|---|---|---|---|
| **1. Triage** | Raymond (CISO) | Within 1 business day of discovery | Severity classification per §5, the affected code path, the customer-data exposure, the reachability. Logged in the §8 register. |
| **2. Review** | Cody (technical lead) | Within 1 business day of triage | A review of the patch: what it changes, what the breaking-change risk is, what the test plan is. Logged in the PR. |
| **3. Security assessment** | Raymond | Within 1 business day of review (parallel with step 4) | If the CVE has a security implication beyond the patch itself (e.g. the CVE is a sign of a deeper issue, the patch requires a config change, the CVE requires a follow-up), the assessment is documented. |
| **4. Test** | Cody | Within 2 business days of review | The three-check suite (`npx tsc --noEmit --skipLibCheck`, `npx eslint <changed files>`, `npx vitest run <affected>`) plus a manual smoke test of the affected code path. Logged in the PR. |
| **5. Merge** | Cody (or the code owner) | After test passes | The PR is merged to `master`. The CI runs the full test suite. |
| **6. Deploy** | Vercel/Render auto-deploy | On merge | The deploy happens automatically on merge to `master`. The deployment is verified in Vercel/Render. |
| **7. Verify** | Cody | Within 1 business day of deploy | The production smoke test confirms the CVE is no longer reachable. `npm audit` (or equivalent) confirms the CVE is gone. Logged in the §8 register. |

The **end-to-end SLA** is the §5 severity-based SLA from the discovery date. The intermediate steps are sized for a 3-person team; the bottleneck is usually the test step (the three-check suite + the smoke test).

### 6.2 The normal workflow (Low)

Low-severity CVEs are batched into a **monthly patch cycle**. The cycle is the first week of each month. The batched PR is reviewed + tested + merged + deployed in a single cycle. The §8 register tracks the low-severity CVEs that are in the queue.

### 6.3 The emergency workflow (KEV CVE)

A CISA KEV CVE is treated as Critical and follows the **emergency workflow**, not the normal workflow. The emergency workflow bypasses the normal review cycle (steps 2-3) and ships in 24 hours. The audit trail is the same; the speed is different.

| Step | Owner | Time bound | Output |
|---|---|---|---|
| **1. Confirm KEV** | Raymond (CISO) | Within 1 hour of discovery | Verify the CVE is in the CISA KEV catalog (https://www.cisa.gov/known-exploited-vulnerabilities-catalog). Confirm the package is in the lockfile. |
| **2. Patch** | Cody (technical lead) | Within 4 hours of confirmation | Apply the patch (Dependabot PR, or a manual PR if Dependabot has not yet opened one). The PR description notes "KEV — emergency." |
| **3. Test** | Cody | Within 8 hours of patch | The three-check suite + a targeted smoke test of the affected code path. The full test suite is not required for the emergency deploy; the full test suite runs on the next regular CI run. |
| **4. Merge + Deploy** | Cody (or Raymond) | Within 12 hours of test | The PR is merged to `master`. The deploy happens automatically. The deployment is verified in Vercel/Render. |
| **5. Notify** | Raymond | Within 12 hours of deploy | Notify James and the customer-facing channels (status page, in-app banner) per the BC/DR Plan (#22) §7. |
| **6. Verify + Postmortem** | Raymond + Cody | Within 24 hours of deploy | The CVE is verified gone (`npm audit` clean, the affected code path is unreachable). A postmortem is filed at `compliance/incidents/<date>-kev-<cve>.md`. The postmortem includes the timeline, the impact, and the action items to prevent recurrence. |

The 24-hour SLA is the ceiling. The actual time is usually 4-8 hours; the SLA is the hard limit.

### 6.4 The exception workflow (patch cannot be applied today)

When a patch cannot be applied (a breaking change, a compatibility issue, the patch is not yet available from the vendor), the exception is documented. The exception is the §7 register entry; the patch is deferred, not abandoned.

| Step | Owner | Time bound | Output |
|---|---|---|---|
| **1. Document the exception** | Cody (technical lead) | Within the §5 SLA from discovery | A Linear issue (or GitHub issue) tagged `patch-exception` with: the CVE, the affected package, the reason the patch cannot be applied, the re-evaluation date (no more than 90 days out), the proposed mitigation, the residual risk. |
| **2. CISO approval** | Raymond (CISO) | Within 1 business day of step 1 | Raymond approves the exception. The approval is in the issue. The exception is added to the §7 register. |
| **3. Mitigation** | Cody | Within 1 business day of approval | The proposed mitigation is implemented. Examples: disable the affected code path, add a WAF rule, add an input validation. |
| **4. Re-evaluation** | Raymond + Cody | On the re-evaluation date | The exception is re-evaluated. The patch is applied, the exception is extended, or the affected functionality is removed. |
| **5. Quarterly review** | Raymond | Quarterly (with the UAR) | All open exceptions are reviewed. Stale exceptions (>90 days) are escalated to James. |

The exception is a documented, time-bound risk acceptance. It is not a permanent "we'll get to it" — the §7 register is the reminder.

### 6.5 The unused-code workflow (CVE in a package that is not actually used)

When a CVE is in a package that is in the lockfile but is not actually used by the application (e.g. a transitive dependency of a dev-only tool, a library that is imported but not called), the workflow is to **remove the unused code** instead of patching. The removal is the patch; the CVE is closed because the affected code path is no longer reachable.

The reachability assessment is part of the §6.1 step 1 (triage). The assessment is documented in the §8 register; the removal PR is the patch.

## 7. Exception register

The exception register is the durable record of every patch that cannot be applied today. The register is at `compliance/patches/exceptions-<year>.csv` (or a similar path; the exact location is the §10 review). The schema:

| Field | Description |
|---|---|
| `date_opened` | The date the exception was opened. |
| `cve_id` | The CVE identifier (e.g. `CVE-2026-12345`). |
| `package` | The affected npm/pip/Docker package. |
| `severity` | The severity classification per §5. |
| `reason` | The reason the patch cannot be applied. |
| `re_eval_date` | The re-evaluation date (no more than 90 days out). |
| `ciso_approval` | The CISO approval (Raymond's name + date). |
| `mitigation` | The proposed mitigation. |
| `status` | Open, Extended, Closed. |
| `closure_date` | The date the exception was closed. |
| `closure_reason` | The reason for closure (patch applied, code removed, exception withdrawn). |

The register is reviewed quarterly (with the UAR). Stale exceptions (>90 days) are escalated to James.

## 8. Records

Every patch, every exception, every emergency, every verification is recorded. The records are the audit trail.

### 8.1 The patch record

A patch record is opened for every CVE that enters the §6 workflow. The record is at `compliance/patches/<YYYY>-<seq>-<cve_id>.md` (or a similar path). The schema:

| Field | Description |
|---|---|
| `cve_id` | The CVE identifier. |
| `discovered_date` | The date the CVE was discovered. |
| `source` | The detection source (Dependabot, GitHub Security Advisory, Snyk, NVD, vendor bulletin). |
| `severity` | The §5 classification. |
| `affected_package` | The affected package + version range. |
| `affected_code_path` | The code path in the application. |
| `reachability` | Reachable, not reachable, dev-only. |
| `customer_data_exposure` | Yes, no. |
| `ciso_review` | Raymond's review + date. |
| `pr_url` | The PR URL. |
| `test_result` | The three-check result. |
| `merge_date` | The merge date. |
| `deploy_date` | The deploy date. |
| `verify_date` | The verification date. |
| `verify_method` | `npm audit`, smoke test, etc. |
| `closed_date` | The closure date. |

The records are aggregated in `compliance/patches/YYYY-patches.csv` for the annual review.

### 8.2 The exception record

The exception record is per §7. The record is a row in the §7 register; the record is the §7 schema.

### 8.3 The emergency record

The emergency record is a postmortem at `compliance/incidents/<date>-kev-<cve>.md`. The postmortem follows the Incident Response Plan (#05) §7 template; the §6.3 step 6 list is the minimum content.

## 9. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **CISO (Owner)** | **Raymond O'Brien** | Owns the policy. Triages CVEs. Approves exceptions. Runs the weekly monitoring review. Reviews the §7 register quarterly. Files the KEV postmortem. |
| **Technical lead** | **Cody** | Implements the patch. Runs the three-check suite. Deploys the fix. Verifies the CVE is gone. Maintains the §7 and §8 records. |
| **Management sign-off** | **James Carpenter** | Approves changes to the §5 severity classification. Approves changes to the §6 SLAs. Signs off on stale exceptions (>90 days). Approves the annual patch management review. |
| **All team members** | James, Raymond, Cody | Receives the Snyk + Dependabot alerts. Reports new CVEs to Raymond within 1 business day. Does not merge a patch without the three-check suite passing. |

A violation (a CVE that is past the §5 SLA without a §6.4 exception, a merged patch without a three-check result, a missing record) is handled per the Information Security Policy (#01) §9 and the Vulnerability Management Policy (#07) §8.

## 10. Review cadence

This policy is reviewed:

- **Annually** — by August 15 of each year, signed off by James and Raymond. The annual review always includes a refresh of the §5 severity classification (CVSS ranges may shift as CVSS v4.0 adoption grows), a refresh of the §4 detection sources (new tools may be available), and a refresh of the §6 SLAs (the team may grow, allowing tighter SLAs).
- **After every KEV emergency** — the postmortem identifies gaps in the §6.3 procedure. The gaps are added to the §6.3 procedure or the §4 detection sources.
- **On material change** — within 30 days of any of: a new framework in scope, a new vendor added to the stack, a new patch class (e.g. a new IaC tool that needs its own scan), or a change in the team.

The revision history at the bottom of this file is the audit trail. See `compliance/policies/REVIEW_PROCESS.md` for the full process.

## 11. Related documents

- `compliance/policies/01-information-security.md` — foundation, risk management, exceptions process.
- `compliance/policies/02-acceptable-use.md` — the endpoint-side rules that complement the dependency-side rules.
- `compliance/policies/05-incident-response.md` — the KEV postmortem template.
- `compliance/policies/06-change-management.md` — the PR + CI + deploy pipeline that the §6 workflow runs through.
- `compliance/policies/07-vulnerability-management.md` — the discovery side of the patch workflow.
- `compliance/policies/17-software-bill-of-materials.md` — the SBOM that lists the components the §4 detection sources scan.
- `compliance/policies/21-encryption-key-management.md` — the key rotation procedure that is the first step in a key compromise recovery (a class of vulnerability).
- `compliance/CONTROL_MATRIX.md` — CC7.1, A.8.8, A.8.9, A.12.6 evidence rows.
- `compliance/patches/` — the §7 exception register and the §8 patch records.
- `SECURITY_ADVISORY_DEPS.md` — the current dependency advisory; the 5 Next.js 14 DoS CVEs that triggered this policy are documented there.
- `HANDOFF_NEXT_15_MIGRATION.md` — the Next 15 migration that closed the 5 CVEs; the policy codifies the cadence that keeps them closed.

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
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 24h/7d/30d/next-cycle SLAs by severity, the KEV emergency path, the §6.4 exception process with a 90-day re-evaluation ceiling, the §7 exception register, the §8 patch records, the CISA KEV escalation rule, and the reachability assessment. Closes the A.8.8 Gap row in the 2026-07-30 control matrix (the 5 unpatched Next.js 14 DoS CVEs are now closed by the Stage 2 Next 15 migration; the policy keeps them closed). |
